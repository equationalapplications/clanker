#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/functions"
export DATABASE_URL="${DATABASE_URL:-postgres://clanker_dev:local_pass@localhost:5432/clanker}"
exec npm run migrate:dev
