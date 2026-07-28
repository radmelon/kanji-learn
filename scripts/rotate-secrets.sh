#!/usr/bin/env bash
#
# Rotate the kanji-learn API secrets into SSM Parameter Store.
#
#   ./scripts/rotate-secrets.sh                              # prompt for the four rotatable secrets
#   ./scripts/rotate-secrets.sh --copy-supabase-from-apprunner   # first-run only, see below
#
# Runbook: docs/secrets-rotation.md
# Next rotation due 2026-10-26 — the three LLM keys expire 90 days after issue.
#
# ─── Why this prompts instead of reading a file ──────────────────────────────
#
# The first version of this read from a template file that an AGENT had
# created. Authoring the file put it under the harness's change tracking, so
# saving it with real values echoed the whole diff — values included — straight
# back into the agent session. Four freshly-issued keys were burned before they
# were ever used.
#
# The distinction is precise: reading a secrets file on request is not what did
# the damage. *Authorship* is, because authorship is what subscribes the agent
# to every later change. Prompting sidesteps it entirely — nothing on disk,
# nothing in shell history, nothing in a transcript.
#
# Pasting is invisible by design (`read -rs` disables echo, like sudo). The
# character count printed after each entry is your confirmation it landed.

set -euo pipefail

REGION="us-east-1"
PREFIX="/kanji-learn/prod"
SERVICE_ARN="${APPRUNNER_SERVICE_ARN:-arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654}"

# Every "$VAR" below is braced. An unbraced "$VAR" followed by a multibyte
# character gets absorbed into the variable name when LANG/LC_ALL are unset
# (bash falls back to the C locale), and `set -u` then aborts with
# "unbound variable". That bug cost a debugging round on 2026-07-28.

put() {  # put <param-name> <value>  — writes, prints name + new version only
  local version
  version="$(aws ssm put-parameter --name "${PREFIX}/${1}" --type SecureString \
    --value "${2}" --region "${REGION}" --overwrite --query 'Version' --output text)"
  printf '  written: %s/%s (now version %s)\n\n' "${PREFIX}" "${1}" "${version}" >&2
}

prompt_put() {  # prompt_put <param-name> <label>
  local value=""
  while [[ -z "${value}" ]]; do
    printf '%s\n  paste, then press Return (input is hidden): ' "${2}" >&2
    read -rs value
    printf '\n' >&2
    if [[ -z "${value}" ]]; then
      printf '  nothing received - try again\n' >&2
      continue
    fi
    # Length only: enough to confirm a paste landed and to catch a stray
    # keystroke, useless to anyone else.
    printf '  received %d characters\n' "${#value}" >&2
  done
  put "${1}" "${value}"
  unset value
}

# ─── First-run helper ────────────────────────────────────────────────────────
# The three Supabase secrets are NOT rotated here — the ap-southeast-2 →
# us-east-1 migration issues a new project and replaces all three by
# construction. But they must exist in Parameter Store before App Runner can
# drop its plaintext copies, so copy the live values across without ever
# displaying them.
if [[ "${1:-}" == "--copy-supabase-from-apprunner" ]]; then
  printf 'Copying current Supabase values from App Runner (not rotating them)\n\n' >&2
  env_json="$(aws apprunner describe-service --service-arn "${SERVICE_ARN}" \
    --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables' \
    --output json)"

  for pair in "DATABASE_URL:database-url" \
              "SUPABASE_JWT_SECRET:supabase-jwt-secret" \
              "SUPABASE_SERVICE_ROLE_KEY:supabase-service-role-key"; do
    src="${pair%%:*}"; dst="${pair##*:}"
    val="$(python3 -c "import json,sys;print(json.load(sys.stdin).get('${src}',''))" <<<"${env_json}")"
    if [[ -z "${val}" ]]; then
      printf 'error: %s not found on App Runner.\n' "${src}" >&2
      printf 'If App Runner has already moved to RuntimeEnvironmentSecrets, these\n' >&2
      printf 'parameters exist and this step is unnecessary.\n' >&2
      exit 1
    fi
    put "${dst}" "${val}"
  done
  unset env_json val
  exit 0
fi

cat >&2 <<'INTRO'
Rotate secrets -> SSM Parameter Store

Issue each new key in its console first, but do NOT revoke the old one until
verification passes (docs/secrets-rotation.md, Step 5) — revoking early breaks
production in the gap between rotating and deploying.

Ctrl-C to abort. Nothing is written until you press Return on a value.

INTRO

prompt_put anthropic-api-key "ANTHROPIC_API_KEY (console.anthropic.com/settings/keys)"
prompt_put groq-api-key      "GROQ_API_KEY      (console.groq.com/keys)"
prompt_put gemini-api-key    "GEMINI_API_KEY    (aistudio.google.com/apikey)"
prompt_put internal-secret   "INTERNAL_SECRET   (openssl rand -hex 32)"

printf 'Parameters present (names + versions only):\n' >&2
aws ssm describe-parameters \
  --parameter-filters "Key=Name,Option=BeginsWith,Values=/kanji-learn" \
  --query 'sort_by(Parameters,&Name)[].{Name:Name,Version:Version}' \
  --output table --region "${REGION}"

cat >&2 <<'NOTE'

Nothing reads these yet — production is unchanged until App Runner is
redeployed (Step 4).

Next: run Steps 3-5 of docs/secrets-rotation.md. Order matters —
App Runner FIRST (a ~4 minute deploy, during which the old container keeps
serving the old secret), then the Lambda's INTERNAL_SECRET the moment that
deploy reports SUCCEEDED (~1 second). Slow side first, fast side catches up.
Start just after an hourly tick (HH:00) for maximum margin.
NOTE
