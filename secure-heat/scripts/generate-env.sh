#!/bin/sh
# Creates .env from .env.example with freshly generated secrets. Refuses to overwrite an existing .env unless --force.
# Requires: openssl. Prints the generated admin login ONCE; it is also stored in .env (file mode 600).
set -eu
cd "$(dirname "$0")/.."
[ -f .env.example ] || { echo "error: .env.example not found" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "error: openssl is required" >&2; exit 1; }
if [ -f .env ] && [ "${1:-}" != "--force" ]; then echo "error: .env already exists (use --force to overwrite)" >&2; exit 1; fi

hex()  { openssl rand -hex "$1"; }
b64()  { openssl rand -base64 "$1" | tr -d '\n'; }
ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@secure-heat.local}"
ADMIN_PW="$(hex 12)"
PG_PW="$(hex 16)"        # hex only: stays URL-safe inside DATABASE_URL

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
set_kv() {   # set_kv KEY VALUE  -> replaces the first "KEY=..." line (keeps any trailing comment out; values never contain '|')
  awk -v k="$1" -v v="$2" 'BEGIN{done=0} { if (!done && index($0, k "=")==1) { print k "=" v; done=1 } else print } END{ if(!done) print k "=" v }' "$tmp" > "$tmp.new" && mv "$tmp.new" "$tmp"
}
cp .env.example "$tmp"
set_kv POSTGRES_PASSWORD "$PG_PW"
set_kv DATABASE_URL "postgresql://secureheat:${PG_PW}@localhost:5432/secureheat"
set_kv JWT_SECRET "$(b64 48)"
set_kv SENSOR_SECRET_ENC_KEY "$(b64 32)"
set_kv ML_INTERNAL_TOKEN "$(hex 24)"
set_kv SIM_CONTROL_TOKEN "$(hex 24)"
set_kv SIMULATOR_TOKEN "$(grep '^SIM_CONTROL_TOKEN=' "$tmp" | cut -d= -f2-)"
set_kv SEED_ADMIN_EMAIL "$ADMIN_EMAIL"
set_kv SEED_ADMIN_PASSWORD "$ADMIN_PW"
set_kv SEED_ON_START true
umask 077; cp "$tmp" .env; chmod 600 .env
echo "Created .env with generated secrets."
echo
echo "  Dashboard login:  $ADMIN_EMAIL"
echo "  Password:         $ADMIN_PW"
echo
echo "Next: docker compose up --build   then open http://localhost:8080"
