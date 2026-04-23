#!/usr/bin/env node
// 3~4월 몰림 완화를 위해 시리즈 시작점·독립 글을 2월로 재배정
// findings-*.md 기준 + 2월 타임라인 배치

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.resolve(__dirname, '../../../../src/content');

// 2월 배치: 상순(초기 ADR/설정) → 중순(시리즈 시작점) → 하순(독립 트러블)
const moves = {
  // ── 2월 상순: 초기 아키텍처 결정·스택 선택
  'goti-hikaricp-otel-beanpostprocessor': '2026-02-02',
  'goti-adr-istio-service-mesh': '2026-02-03',
  'goti-observability-stack-selection': '2026-02-04',
  'goti-cloudfront-swagger-403': '2026-02-05',
  'goti-adr-alloy-to-otel-collector': '2026-02-05',
  'goti-gcp-terraform-cross-cloud-review': '2026-02-06',
  'goti-alloy-mimir-rules-duplicate-metrics': '2026-02-07',
  'goti-metrics-collector-go-sidecar': '2026-02-08',
  'goti-logging-convention-adr': '2026-02-09',
  // ── 2월 중순: 시리즈 시작점·GitOps 초기
  'goti-ecr-secret-dollar-escape': '2026-02-10',
  'goti-image-updater-multisource': '2026-02-11',
  'goti-adr-loki-tempo-stability-tuning': '2026-02-11',
  'goti-renovate-ecr-auth-failure': '2026-02-12',
  'goti-discord-alerting-architecture': '2026-02-13',
  'goti-observer-db-auth-failure-readonly-user': '2026-02-14',
  'goti-decision-redis-exporter-deployment': '2026-02-15',
  'goti-payment-token-encryptor-32byte': '2026-02-16',
  'goti-servicemonitor-release-label-missing': '2026-02-17',
  'goti-review-pr-gap-learning': '2026-02-18',
  'goti-ssm-manual-config-troubleshooting': '2026-02-18',
  // ── 2월 하순: 독립 트러블슈팅·PoC 설계
  'goti-queue-loadtest-k6-two-phase-design': '2026-02-20',
  'goti-kind-db-connection-false-negative': '2026-02-20',
  'goti-redis-first-ticketing-adr': '2026-02-22',
  'goti-tempo-scoped-tag-traceql-variable': '2026-02-23',
  'goti-poc-ab-test-dependency-isolation-pattern': '2026-02-24',
  'goti-kubectl-toleration-imagepullbackoff': '2026-02-25',
  'goti-servicemap-promql-syntax-error': '2026-02-26',
};

let changed = 0;
const missing = [];
const unchanged = [];

for (const [slug, newDate] of Object.entries(moves)) {
  const fp = path.join(CONTENT_DIR, slug + '.md');
  if (!fs.existsSync(fp)) {
    missing.push(slug);
    continue;
  }
  const raw = fs.readFileSync(fp, 'utf8');
  const updated = raw.replace(
    /^(date:\s*['"]?)\d{4}-\d{2}-\d{2}(['"]?)/m,
    `$1${newDate}$2`,
  );
  if (raw !== updated) {
    fs.writeFileSync(fp, updated, 'utf8');
    changed++;
  } else {
    unchanged.push(slug);
  }
}

console.log(`✔ ${changed}/${Object.keys(moves).length} 파일 수정`);
if (missing.length) console.log('⚠ 없는 파일:', missing);
if (unchanged.length) console.log('ⓘ 변경 없음(date 포맷 다름?):', unchanged);
