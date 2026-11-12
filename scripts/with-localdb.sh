#!/usr/bin/env bash
# Runs a command with the local PostgreSQL started, then stops it again.
# Usage: scripts/with-localdb.sh <command> [args...]
# The server is the portable copy in the project's .tools folder; it listens on 127.0.0.1 only.
set -euo pipefail

tools="$(cd "$(dirname "$0")/.." && pwd)/.tools"
pg_ctl="$tools/pgsql/bin/pg_ctl.exe"
data="$(cygpath -m "$tools/pgdata")"

started=0
if ! "$pg_ctl" -D "$data" status > /dev/null 2>&1; then
  # Output goes to a file, never a pipe: the server inherits the handle and a pipe would never close.
  "$pg_ctl" -D "$data" -l "$tools/pg.log" -o "-p 5432 -c listen_addresses=127.0.0.1" -w start > "$tools/pg_ctl.out" 2>&1
  started=1
fi
stop() {
  if [ "$started" = 1 ]; then
    "$pg_ctl" -D "$data" -m fast -w stop > "$tools/pg_ctl.out" 2>&1 || true
  fi
}
trap stop EXIT

"$@"
