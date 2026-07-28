# Secrets rotation + SSM Parameter Store migration

**Canonical URL — hand this to a new session:**
https://github.com/radmelon/kanji-learn/blob/main/docs/secrets-rotation.md

Written 2026-07-28. Supersedes the inline checklist in `ROADMAP.md` Wave 5,
which is now a pointer to this file.

**The rule that governs every step: a secret value never enters an agent
session.** Every command below reads values from a local file or a prompt. If
you find yourself about to paste a key into chat, stop — that is how five of
these seven came to be on this list.

---

## Why now, and why only four keys

Seven secrets sit in App Runner's `RuntimeEnvironmentVariables` as plaintext.
Verified 2026-07-28: `RuntimeEnvironmentSecrets` is `null`, no `/kanji-learn`
SSM parameters exist, and the instance role `kanji-learn-apprunner-instance`
carries only `ses-send`.

**Supabase has no in-place region change.** Moving `ap-southeast-2` →
`us-east-1` means creating a *new* project and migrating into it, which issues
a new project ref, new anon/service keys, a new JWT secret and a new database
password. So four of the seven rotate by construction during that migration:

| Secret | Rotate now | Rotated by the region migration |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | |
| `GROQ_API_KEY` | ✅ | |
| `GEMINI_API_KEY` | ✅ | |
| `INTERNAL_SECRET` | ✅ ⚠️ see below | |
| `DATABASE_URL` | | ✅ new password |
| `SUPABASE_JWT_SECRET` | | ✅ new project |
| `SUPABASE_SERVICE_ROLE_KEY` | | ✅ new project |

Rotating the Supabase four now is throwaway work. **All seven still move to SSM
now** — that is what closes the plaintext exposure, and it makes the later
cutover a `put-parameter --overwrite` plus one deploy, with no App Runner
config change at all, because the ARNs do not move.

### Not secrets, and staying as plain env vars

`API_BASE_URL`, `AWS_REGION`, `CORS_ORIGIN`, `HOST`, `LOG_LEVEL`,
`MILESTONES_DEPLOY_CUTOFF_ISO`, `NODE_ENV`, `PORT`, `SES_SENDER_EMAIL`,
`SUPABASE_URL`.

The Supabase **anon key** (`EXPO_PUBLIC_SUPABASE_ANON_KEY`, an EAS environment
variable) is also not on this list. It is public by design — it ships inside
every app bundle and is protected by RLS. It does not need rotating.

---

## ⚠️ `INTERNAL_SECRET` is shared with the Lambda

Verified 2026-07-28: `kanji-learn-daily-reminders` has exactly two environment
variables, `API_BASE_URL` and `INTERNAL_SECRET`. It uses that secret to
authenticate `POST /internal/daily-reminders` on the hourly EventBridge tick.

**Changing it on one side alone silently breaks every daily reminder.** The
Lambda starts getting 401s; nothing in the app says so, and the symptom —
reminders stop arriving — is indistinguishable from the three-month bug closed
on 2026-07-28 (root causes A/B/C in `BUGS.md`, plus B-221).

The two sides cannot change atomically, so the goal is the shortest possible
mismatch window. **App Runner first, Lambda immediately after:**

1. `put-parameter` the new value. Nothing reads it yet; production is unchanged.
2. Deploy App Runner pointing at the new parameter. This takes **~4 minutes**,
   and throughout it the old container is still serving with the old secret, so
   the Lambda keeps working.
3. The moment that deploy reports SUCCEEDED, update the Lambda —
   **~1 second**. That is the entire mismatch window.
4. Confirm on the next tick: `[Internal] Daily reminder job triggered by
   EventBridge` at `HH:00:0x` in the App Runner application log, and
   `Success (200)` in `/aws/lambda/kanji-learn-daily-reminders`.

> **Corrected 2026-07-28.** An earlier version of this file said to update the
> Lambda *first*, on the reasoning that it is the caller. That is wrong on
> timing: it makes the mismatch window the whole four-minute App Runner deploy
> instead of the one second a Lambda update takes. Slow side first, fast side
> catches up.

Do the cutover just after an hourly tick and even a bungled window costs
nothing — there is ~59 minutes of margin before the next one.

---

## Step 1 — rotate the four independent keys (you, in your own terminal)

> **2026-07-28: this step was run once and must be run again.** The first
> attempt used an agent-authored template file, and saving it fed all four
> values back into the agent session (see Chat hygiene, below). Those four keys
> are burned. They were written to SSM but never read by anything — App Runner
> was never switched over — so there is no production impact, and overwriting
> the same four parameters with fresh values is the whole remedy.
>
> The three Supabase parameters were copied from App Runner by the script
> without ever being displayed, and are fine as they are.

In each provider console, issue a new key and revoke the old one:

- **Anthropic** — console.anthropic.com → API keys
- **Groq** — console.groq.com → API keys
- **Gemini** — aistudio.google.com → API keys
- **`INTERNAL_SECRET`** — no console; generate one:

```bash
openssl rand -hex 32 > ~/tmp/internal-secret.txt
```

Write each new value to its own file under a directory only you can read:

```bash
mkdir -p ~/tmp/kl-secrets && chmod 700 ~/tmp/kl-secrets
```

One file per secret, no trailing newline concerns — `put-parameter` below
handles that.

## Step 2 — create the SSM parameters (you)

Values are read from files, so they never appear in a command line, shell
history, or any tool output. Run for all seven — the three Supabase ones take
their *current* values for now.

```bash
for k in anthropic-api-key groq-api-key gemini-api-key internal-secret \
         database-url supabase-jwt-secret supabase-service-role-key; do
  aws ssm put-parameter --name "/kanji-learn/prod/$k" --type SecureString \
    --value "$(cat ~/tmp/kl-secrets/$k)" --region us-east-1 --overwrite
done
```

Confirm names only — never `get-parameter` with decryption in a shared session:

```bash
aws ssm describe-parameters --parameter-filters "Key=Name,Option=BeginsWith,Values=/kanji-learn" --query 'Parameters[].Name' --output table
```

## Step 3 — IAM read policy (agent-safe, ARNs only)

```bash
aws iam put-role-policy --role-name kanji-learn-apprunner-instance \
  --policy-name ssm-read-prod --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["ssm:GetParameters"],
      "Resource": "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/*"
    }]
  }'
```

KMS permissions are **not** required for the AWS-managed `aws/ssm` key — roles
can decrypt under it by default. A customer-managed CMK would need an
additional `kms:Decrypt` statement.

## Step 4 — Lambda first, then App Runner

Lambda (the caller — see the warning above):

```bash
aws lambda update-function-configuration --function-name kanji-learn-daily-reminders \
  --environment "Variables={API_BASE_URL=https://73x3fcaaze.us-east-1.awsapprunner.com,INTERNAL_SECRET=$(cat ~/tmp/kl-secrets/internal-secret)}"
```

Then App Runner: move all seven from `RuntimeEnvironmentVariables` to
`RuntimeEnvironmentSecrets` as ARN references. App Runner resolves each ARN at
container start and injects the **decrypted value** as a normal env var, so
Fastify reads `process.env.GROQ_API_KEY` exactly as today — **no code change**.

```jsonc
"RuntimeEnvironmentSecrets": {
  "ANTHROPIC_API_KEY":         "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/anthropic-api-key",
  "GROQ_API_KEY":              "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/groq-api-key",
  "GEMINI_API_KEY":            "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/gemini-api-key",
  "INTERNAL_SECRET":           "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/internal-secret",
  "DATABASE_URL":              "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/database-url",
  "SUPABASE_JWT_SECRET":       "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/supabase-jwt-secret",
  "SUPABASE_SERVICE_ROLE_KEY": "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/supabase-service-role-key"
}
```

The seven must be **removed** from `RuntimeEnvironmentVariables` in the same
update — leaving them in both is not an error, and the plaintext copy would
survive, which is the whole thing this exercise exists to remove.

## Step 5 — verify, by content

Status codes prove nothing here (see `SOP.md`). Each secret needs a call that
can only succeed if the value resolved:

| Secret | Proof |
|---|---|
| `DATABASE_URL` | any authenticated read, e.g. `GET /v1/kanji/1` returns `components` |
| `SUPABASE_JWT_SECRET` | sign in on device — a bad secret 401s every request |
| `SUPABASE_SERVICE_ROLE_KEY` | a route using the service client |
| `ANTHROPIC_API_KEY` | `POST /v1/mnemonics/assemble` returns woven prose |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | tier-2/3 fallback — force by an invalid Anthropic key in a scratch deploy, or accept lower assurance |
| `INTERNAL_SECRET` | the next hourly tick logs `Success (200)` — see above |

Also confirm the plaintext is gone:

```bash
aws apprunner describe-service --service-arn "$APPRUNNER_SERVICE_ARN" \
  --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables | keys(@)'
```

Seven names should have disappeared from that list.

## Step 6 — local `.env`

`packages/db/.env` still holds the old values. Update it yourself; no agent
should `cat` it. `scripts/with-live-db.sh` reads it into a child process only.

---

## Routine rotation, afterwards

The point of Parameter Store is that rotation stops being a config change:

```bash
aws ssm put-parameter --name /kanji-learn/prod/<key> --type SecureString \
  --value "$(cat ~/tmp/kl-secrets/<key>)" --region us-east-1 --overwrite
aws apprunner start-deployment --service-arn "$APPRUNNER_SERVICE_ARN"
```

Quarterly is the operating model — there is no automated rotation, which is
why Parameter Store was chosen over Secrets Manager ($0.40/secret/month for
rotation infrastructure this project does not use). Standard `SecureString`
parameters are free under the AWS-managed `aws/ssm` key.

**Remember `INTERNAL_SECRET` is two-sided.** Lambda first, always.

---

## Chat hygiene — the rules that would have prevented this list

- **An agent must never create the file a human will paste secrets into.**
  Learned the hard way on 2026-07-28: the agent wrote a `rotate-*.env` template
  with blanks to fill. Authoring it put the file under the harness's change
  tracking, so saving it with real values echoed the whole diff — values
  included — straight back into the agent session. Four freshly-issued keys
  were burned before they were ever used.

  The distinction is precise: *reading* a secrets file on request is not what
  did the damage. *Authorship* is, because authorship is what subscribes the
  agent to every later change. If a file must exist, the human creates it.
  Better still, avoid the file — `read -rs` at a prompt puts nothing on disk,
  nothing in shell history, and nothing in a transcript.

- **Don't put `$VAR` next to a multibyte character in a shell script.** The
  first `load-to-ssm.sh` had `echo "Updating $LAMBDA…"`. `LANG` and `LC_ALL`
  are unset on this machine, so bash runs in the C locale, absorbs the
  ellipsis bytes into the variable name, and `set -u` aborts with
  `LAMBDA?: unbound variable`. Brace them: `${LAMBDA}`.


- Never run `describe-service`, `get-parameter`, `env` or `eas env:list`
  without scoping output to **names**. On 2026-04-20 a `describe-service`
  returned the full `RuntimeEnvironmentVariables` map to a transcript; that
  single call is why four of these seven are on the rotation list.
- Never `cat` or `grep` a file known to hold secrets — `.env`,
  `credentials.json`, `*.key`. A redaction regex missed the `postgresql://`
  scheme once already, which is the origin of the database-password exposure
  open since 2026-06-03.
- Secret rotation is always **your** action in **your** terminal. Agents
  operate on ARN references only.
