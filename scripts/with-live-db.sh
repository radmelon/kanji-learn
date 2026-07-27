#!/usr/bin/env bash
#
# Run a command with the live DATABASE_URL loaded from packages/db/.env,
# without printing it, echoing it, or leaving it in your shell history.
#
#   ./scripts/with-live-db.sh pg_dump -f /tmp/live.sql "$DATABASE_URL"   # NO — see below
#   ./scripts/with-live-db.sh psql -c '\d user_profiles'                 # yes
#
# The wrapped command inherits DATABASE_URL in its environment, so tools that
# read it implicitly (psql, pg_dump, node scripts) just work with no argument:
#
#   ./scripts/with-live-db.sh psql -c 'SELECT count(*) FROM mnemonics'
#   ./scripts/with-live-db.sh pg_dump -f /tmp/plan4-safety/live.sql
#   ./scripts/with-live-db.sh psql -f packages/db/supabase/migrations/0027_plan4_flags.sql
#   ./scripts/with-live-db.sh node scripts/cleanup-old-mnemonics.mjs --dry-run
#
# psql and pg_dump read PGDATABASE-style connection info from the environment,
# so we export both DATABASE_URL (for node scripts) and PGURL-equivalent args.
#
# Why this exists: the live DB password was once printed to a transcript in
# plaintext (a redaction regex missed the postgresql:// scheme) and rotation is
# still outstanding. The fix is to stop handling the value at all.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/packages/db/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

# -f2- keeps everything after the first '=', so a password containing '=' survives.
raw="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
if [[ -z "$raw" ]]; then
  echo "error: DATABASE_URL not defined in $ENV_FILE" >&2
  exit 1
fi

# Strip optional surrounding quotes.
raw="${raw%\"}"; raw="${raw#\"}"
raw="${raw%\'}"; raw="${raw#\'}"

export DATABASE_URL="$raw"
# psql/pg_dump accept a connection URI via PGSERVICE-less env by way of this:
export PGURI="$raw"

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <command> [args...]" >&2
  echo "DATABASE_URL is loaded and exported to the child process only." >&2
  exit 64
fi

# psql and pg_dump take the URI as a positional argument. If the caller did not
# supply one, append it so the common cases above work verbatim.
cmd="$1"
case "$cmd" in
  psql|pg_dump|pg_restore)
    exec "$@" "$DATABASE_URL"
    ;;
  *)
    exec "$@"
    ;;
esac
