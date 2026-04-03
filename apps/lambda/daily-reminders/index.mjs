/**
 * daily-reminders — EventBridge Scheduler → Lambda
 *
 * Calls the API's protected POST /internal/daily-reminders endpoint.
 * No database access needed here — the API handles all the work.
 *
 * Required environment variables:
 *   API_BASE_URL     — e.g. https://abc123.us-east-1.awsapprunner.com
 *   INTERNAL_SECRET  — shared secret (must match API's INTERNAL_SECRET)
 *
 * Deployment:
 *   zip -j daily-reminders.zip index.mjs
 *   aws lambda create-function \
 *     --function-name kanji-learn-daily-reminders \
 *     --runtime nodejs20.x \
 *     --handler index.handler \
 *     --zip-file fileb://daily-reminders.zip \
 *     --role arn:aws:iam::ACCOUNT_ID:role/lambda-basic-execution
 *
 * EventBridge rule (fires at 20:00 UTC daily):
 *   cron(0 20 * * ? *)
 */

export async function handler(event) {
  const apiUrl = process.env.API_BASE_URL
  const secret = process.env.INTERNAL_SECRET

  if (!apiUrl || !secret) {
    throw new Error('Missing required env vars: API_BASE_URL, INTERNAL_SECRET')
  }

  const url = `${apiUrl.replace(/\/$/, '')}/internal/daily-reminders`
  console.log(`[daily-reminders] POST ${url}`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  const body = await res.text()

  if (!res.ok) {
    throw new Error(`API responded ${res.status}: ${body}`)
  }

  console.log(`[daily-reminders] Success (${res.status}):`, body)
  return { statusCode: res.status, body }
}
