#!/usr/bin/env bash
# 인자 없는 래퍼 — `!` 실행 시 인자가 떨어지는 문제 회피
exec "$(dirname "${BASH_SOURCE[0]}")/pin-frequency.sh" on
