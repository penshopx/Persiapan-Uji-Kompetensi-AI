#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/scripts/setup-ujk-review.ts
