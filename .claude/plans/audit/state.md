# 현재 진행 상태

**마지막 업데이트**: 2026-04-24
**현재 Phase**: Phase 3 실행 — 🟢 6/8 결정 완료, 리라이트 2건 대기

## Phase 3 실행 결과

| # | 결정 | 상태 | 커밋 |
|---|------|------|------|
| 1 | istio-part* 4편 삭제 | ✅ 완료 | `12443b2` |
| 2 | goti-meta 스킬보강 4편 → 1편 병합 | ✅ 완료 | `4db092f` |
| 3 | error-tracking 2편 → 1편 병합 | ✅ 완료 | `f573402` |
| 4 | Claude vs Gemini 2편 시리즈 분리 | ✅ 완료 | `f061589` |
| 5 | wsl2-k3s-troubleshooting 리라이트 | ⏸ 보류 | 별도 세션 |
| 6 | B유형 서사/컨텍스트 결여 리라이트 3편 | ⏸ 보류 | 별도 세션 |
| 7 | 27편 2월 재배정 | ✅ 완료 | `1491db8` |
| 8 | 유형 메타 태그 188편 부여 | ✅ 완료 | `95da1fb` |

## 감사 이후 상태

- **총 편수**: 196 → **188** (-8)
- **월별 분포**:
  - 2026-02: 2 → **29편** (2월 이동 27편)
  - 2026-03: 73 → **47편** (-26)
  - 2026-04: 59 → **54편** (-5)
- **유형 분포** (신설):
  - troubleshooting: 122편
  - adr: 34편
  - concept: 23편
  - retrospective: 9편
- **CLAUDE.md 통계 업데이트 완료**

## 다음에 할 일 (별도 세션 권장)

### 리라이트 (결정 5, 6)

공수 크고 개별 글별 신중한 접근 필요

1. `wsl2-k3s-troubleshooting` — 설명 보강 (코드 64% → 설명 비중 올리기, 맥락 why 추가)
2. `multi-repo-cicd-strategy` — mono vs multi 대안 비교 + 우리 프로젝트 맥락 why
3. `goti-queue-poc-performance-comparison` — 처리량 목표·POC 선택 기준 보강
4. `queue-poc-loadtest-part3-selection` — 대용량/무중단 목표 → 왜 이 PoC를 택했는지 결정 서사

### 유형 태그 스팟 체크 (선택)

`type-assignments.md`에서 오분류 스캔. 특히 이런 케이스들 확인 가치 있음
- `istio-ambient-part4-wealist-migration` → concept인데 adr일 수도
- L2 심화 시리즈 중 개념이 아닌 트러블슈팅이 concept로 잡힌 것들
- 독립 글 중 "-strategy" 없는 ADR성 글

사소한 오분류는 직접 frontmatter에서 유형 태그만 교체하면 됩니다

## 세션 인계 메모

- **블로그 감사 프로젝트는 핵심 실행이 모두 완료**됨
- 리라이트 2건은 글별로 컨텍스트가 커서 사용자와 동행하는 게 낫습니다
- 날짜 이동은 `tags[0]="go-ti"` 컨벤션 / 시리즈 연속성 모두 보존됨
- 유형 태그는 자동 분류라 오분류 가능성 있음 → `type-assignments.md` 참조
- 빌드/린트 확인은 아직 안 함 → 사용자가 `npm run build`로 최종 확인 권장
