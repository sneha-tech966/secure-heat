#!/bin/sh
# Applies migrations, optionally seeds demo data, then starts the API. Fails fast (non-zero) if migrations fail.
set -eu

echo "[entrypoint] applying database migrations"
npx prisma migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] seeding (SEED_ON_START=true): users, demo sensors, SYNTHETIC history"
  node dist/prisma/seed.js
fi

echo "[entrypoint] starting API"
exec node dist/src/server.js
