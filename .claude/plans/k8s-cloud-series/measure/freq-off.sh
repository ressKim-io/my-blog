#!/usr/bin/env bash
# 인자 없는 래퍼 — 측정 종료 후 주파수 복원
exec "$(dirname "${BASH_SOURCE[0]}")/pin-frequency.sh" off
