#!/usr/bin/env bash
# Base PostgreSQL de développement, propre au projet (aucun droit administrateur requis).
# Usage : scripts/dev-db.sh start|stop|status|reset
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV="$ROOT/.dev"
DATA="$DEV/pgdata"
SOCK="$DEV/pgsock"
PORT="${SOMIDAC_DEV_PG_PORT:-5433}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
USER_DB="somidac"
PASS_DB="somidac_dev"

init() {
  mkdir -p "$DEV" "$SOCK"
  local pwfile; pwfile="$(mktemp)"; echo "$PASS_DB" > "$pwfile"
  "$PGBIN/initdb" -D "$DATA" -U "$USER_DB" --pwfile="$pwfile" \
    --auth-local=scram-sha-256 --auth-host=scram-sha-256 -E UTF8 --locale=C.UTF-8 >/dev/null
  rm -f "$pwfile"
}

start() {
  [ -d "$DATA" ] || init
  if "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then echo "Déjà démarrée (port $PORT)"; return; fi
  "$PGBIN/pg_ctl" -D "$DATA" -l "$DEV/postgres.log" -w \
    -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" start >/dev/null
  for db in somidac somidac_test; do
    PGPASSWORD="$PASS_DB" "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U "$USER_DB" -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
      || PGPASSWORD="$PASS_DB" "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U "$USER_DB" "$db"
  done
  echo "PostgreSQL démarré : postgres://$USER_DB:$PASS_DB@127.0.0.1:$PORT/somidac"
}

case "${1:-start}" in
  start) start ;;
  stop) "$PGBIN/pg_ctl" -D "$DATA" -m fast stop ;;
  status) "$PGBIN/pg_ctl" -D "$DATA" status ;;
  reset) "$PGBIN/pg_ctl" -D "$DATA" -m fast stop 2>/dev/null || true; rm -rf "$DATA"; start ;;
  *) echo "Usage : $0 start|stop|status|reset"; exit 1 ;;
esac
