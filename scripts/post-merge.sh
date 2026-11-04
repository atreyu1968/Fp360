#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile --prefer-offline

# Push the database schema only when this merge changes its source. Running
# Drizzle on every task merge needlessly pulls the live schema and can exceed
# the post-merge time limit even when the database is unchanged.
if ! git rev-parse --verify HEAD^ >/dev/null 2>&1 ||
  ! git diff --quiet HEAD^ HEAD -- \
    lib/db/src/schema \
    lib/db/src/index.ts \
    lib/db/migrations \
    lib/db/drizzle.config.ts; then
  echo "Database schema changed; applying Drizzle schema push."
  pnpm --filter @workspace/db run push
else
  echo "Database schema unchanged; skipping Drizzle schema push."
fi
