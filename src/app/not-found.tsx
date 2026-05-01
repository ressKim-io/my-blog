import Link from '@/components/Link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="min-h-[70vh] flex items-center justify-center pt-12 pb-24">
        <div className="max-w-[640px] w-full mx-auto px-5 text-center">
          <p className="text-[12px] font-semibold text-[var(--accent)] uppercase tracking-[0.14em] mb-5">
            404 — Not Found
          </p>
          <h1 className="text-[44px] md:text-[56px] font-bold leading-[1.1] tracking-tight text-[var(--text)]">
            페이지를 찾을 수 없습니다
          </h1>
          <p className="mt-5 text-[16px] text-[var(--muted)] leading-relaxed">
            URL이 변경됐거나, 글이 삭제됐거나, 처음부터 없던 주소입니다.
            아래에서 원하시는 곳으로 이동해 주세요.
          </p>
          <div className="mt-10 grid sm:grid-cols-3 gap-3">
            <Link
              href="/essays"
              className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--elevated)] hover:border-[var(--essays)] transition-colors text-left"
            >
              <div className="text-[15px] font-semibold text-[var(--text)] group-hover:text-[var(--essays)] transition-colors">
                Essays →
              </div>
              <p className="mt-1 text-[12px] text-[var(--muted)]">개념 · ADR · 회고</p>
            </Link>
            <Link
              href="/logs"
              className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--elevated)] hover:border-[var(--logs)] transition-colors text-left"
            >
              <div className="text-[15px] font-semibold text-[var(--text)] group-hover:text-[var(--logs)] transition-colors">
                Logs →
              </div>
              <p className="mt-1 text-[12px] text-[var(--muted)]">현장 기록 · 트러블슈팅</p>
            </Link>
            <Link
              href="/projects"
              className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--elevated)] hover:border-[var(--projects)] transition-colors text-left"
            >
              <div className="text-[15px] font-semibold text-[var(--text)] group-hover:text-[var(--projects)] transition-colors">
                Projects →
              </div>
              <p className="mt-1 text-[12px] text-[var(--muted)]">go-ti · AI 개선</p>
            </Link>
          </div>
          <Link
            href="/"
            className="inline-block mt-8 text-[14px] text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
          >
            ← Home
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
