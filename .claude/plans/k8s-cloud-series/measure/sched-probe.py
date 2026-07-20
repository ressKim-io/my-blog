#!/usr/bin/env python3
"""스케줄링 지연·steal time 측정 에이전트 (호스트/게스트 공용)

5편 재실측용. 호스트(L0)와 KVM 게스트(L1)에서 **동일 바이너리·동일 인자**로 실행해
결과 JSON을 대조하는 것이 목적이다. 그래야 이중 스케줄링 세금을 사과 대 사과로 비교할 수 있다.

주 지표 — /proc/<pid>/schedstat 2번째 필드 (run_delay):
    태스크가 실행 가능(runnable) 상태로 런큐에서 **대기한** 누적 나노초.
    커널 CFS가 직접 계상하므로 게스트 안에서도 게스트 커널 기준으로 정확하다.
    게스트에서 이 값이 커진다면 게스트 커널 레벨의 경합이고,
    steal time이 커진다면 호스트 레벨(하이퍼바이저)의 선점이다.
    둘을 함께 읽어야 "이중" 스케줄링을 분리해 볼 수 있다.

보조 지표 — /proc/stat 8번째 필드 (steal):
    호스트에 의해 빼앗긴 시간. 베어메탈에서는 항상 0이며,
    게스트에서 오버스크립션 시에만 유의미하게 상승한다.

루트 권한을 요구하지 않는다 (cyclictest의 RT 우선순위와 달리).
"""

import argparse
import json
import multiprocessing as mp
import os
import platform
import socket
import time

CLK_TCK = os.sysconf("SC_CLK_TCK")


def read_schedstat(pid="self"):
    """(cpu_time_ns, run_delay_ns, timeslices) 반환"""
    with open(f"/proc/{pid}/schedstat") as f:
        a, b, c = f.read().split()
    return int(a), int(b), int(c)


def read_proc_stat_cpu():
    """/proc/stat 첫 cpu 행을 jiffies dict로. steal은 8번째 값"""
    with open("/proc/stat") as f:
        fields = f.readline().split()
    keys = ["user", "nice", "system", "idle", "iowait",
            "irq", "softirq", "steal", "guest", "guest_nice"]
    vals = [int(v) for v in fields[1:11]]
    return dict(zip(keys, vals))


def burn(duration_s, result_q, idx):
    """CPU를 duration_s 동안 태우며 자기 자신의 schedstat 델타를 보고한다"""
    cpu0, delay0, slices0 = read_schedstat()
    t0 = time.monotonic()
    deadline = t0 + duration_s

    # 부동소수 연산 루프. 컴파일러/인터프리터가 걷어내지 못하도록 누산값을 유지한다
    acc = 0.0
    iters = 0
    while time.monotonic() < deadline:
        for _ in range(10000):
            acc = acc * 1.0000001 + 1.0
        iters += 10000

    t1 = time.monotonic()
    cpu1, delay1, slices1 = read_schedstat()
    result_q.put({
        "worker": idx,
        "wall_ns": int((t1 - t0) * 1e9),
        "cpu_ns": cpu1 - cpu0,
        "run_delay_ns": delay1 - delay0,
        "timeslices": slices1 - slices0,
        "iterations": iters,
        "_acc": acc,  # 최적화 방지용, 리포트에서 제거됨
    })


def collect_env():
    env = {
        "hostname": socket.gethostname(),
        "kernel": platform.release(),
        "arch": platform.machine(),
        "nproc": os.cpu_count(),
    }
    # 하이퍼바이저 여부 — 게스트면 flags에 hypervisor가 보인다
    try:
        with open("/proc/cpuinfo") as f:
            cpuinfo = f.read()
        env["is_guest"] = "hypervisor" in cpuinfo
        for line in cpuinfo.splitlines():
            if line.startswith("model name"):
                env["cpu_model"] = line.split(":", 1)[1].strip()
                break
    except OSError:
        env["is_guest"] = None
    # KVM 게스트라면 어떤 하이퍼바이저인지
    try:
        with open("/sys/hypervisor/type") as f:
            env["hypervisor_type"] = f.read().strip()
    except OSError:
        pass
    try:
        with open("/sys/class/dmi/id/product_name") as f:
            env["dmi_product"] = f.read().strip()
    except OSError:
        pass
    return env


def main():
    ap = argparse.ArgumentParser(description="스케줄링 지연·steal time 측정")
    ap.add_argument("--workers", type=int, default=os.cpu_count(),
                    help="CPU를 태울 워커 프로세스 수 (기본: nproc)")
    ap.add_argument("--duration", type=int, default=30,
                    help="측정 시간(초)")
    ap.add_argument("--label", default="unlabeled",
                    help="결과 식별 라벨 (예: host-baseline, guest-oversub)")
    ap.add_argument("--out", default="-",
                    help="결과 JSON 경로 ('-'면 stdout)")
    args = ap.parse_args()

    stat0 = read_proc_stat_cpu()
    with open("/proc/loadavg") as f:
        load0 = f.read().split()[:3]

    t_start = time.time()
    q = mp.Queue()
    procs = [mp.Process(target=burn, args=(args.duration, q, i))
             for i in range(args.workers)]
    for p in procs:
        p.start()

    workers = [q.get() for _ in procs]
    for p in procs:
        p.join()
    t_end = time.time()

    stat1 = read_proc_stat_cpu()
    with open("/proc/loadavg") as f:
        load1 = f.read().split()[:3]

    for w in workers:
        w.pop("_acc", None)
    workers.sort(key=lambda w: w["worker"])

    delta_jiffies = {k: stat1[k] - stat0[k] for k in stat0}
    total_jiffies = sum(delta_jiffies.values())

    total_wall = sum(w["wall_ns"] for w in workers)
    total_cpu = sum(w["cpu_ns"] for w in workers)
    total_delay = sum(w["run_delay_ns"] for w in workers)
    delays = sorted(w["run_delay_ns"] for w in workers)

    def pct(p):
        if not delays:
            return None
        k = min(int(len(delays) * p / 100), len(delays) - 1)
        return delays[k]

    report = {
        "label": args.label,
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(t_start)),
        "config": {
            "workers": args.workers,
            "duration_s": args.duration,
        },
        "env": collect_env(),
        "loadavg": {"before": load0, "after": load1},
        "cpu_time_jiffies": delta_jiffies,
        "cpu_time_pct": (
            {k: round(v * 100.0 / total_jiffies, 4) for k, v in delta_jiffies.items()}
            if total_jiffies else {}
        ),
        # 핵심 지표: 워커가 CPU를 쓴 시간 대비 런큐에서 기다린 시간의 비율
        "sched": {
            "total_wall_ns": total_wall,
            "total_cpu_ns": total_cpu,
            "total_run_delay_ns": total_delay,
            "run_delay_ratio": round(total_delay / total_cpu, 6) if total_cpu else None,
            "cpu_efficiency": round(total_cpu / total_wall, 6) if total_wall else None,
            "run_delay_p50_ns": pct(50),
            "run_delay_p90_ns": pct(90),
            "run_delay_max_ns": delays[-1] if delays else None,
        },
        "workers": workers,
        "wall_elapsed_s": round(t_end - t_start, 3),
    }

    text = json.dumps(report, indent=2, ensure_ascii=False)
    if args.out == "-":
        print(text)
    else:
        with open(args.out, "w") as f:
            f.write(text + "\n")
        print(f"wrote {args.out}")

    s = report["sched"]
    st = report["cpu_time_pct"].get("steal", 0.0)
    print(f"[{args.label}] run_delay_ratio={s['run_delay_ratio']} "
          f"cpu_efficiency={s['cpu_efficiency']} steal={st}%")


if __name__ == "__main__":
    main()
