#!/usr/bin/env node
/**
 * Generate an Apple Client Secret JWT for Sign In with Apple / Supabase.
 *
 * Usage:
 *   node scripts/generate-apple-client-secret.js \
 *     --key-file ./AuthKey_XXXXXXXX.p8 \
 *     --key-id 5UG82A4V8P \
 *     --team-id YOUR_TEAM_ID \
 *     --service-id com.rdennis.kanjilearn2.signin
 *
 * The JWT is valid for 6 months (Apple's maximum). Paste the output into
 * Supabase Dashboard → Authentication → Providers → Apple → Secret Key.
 */

const crypto = require('crypto')
const fs = require('fs')

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getArg(name) {
  const idx = args.indexOf(name)
  if (idx === -1 || idx + 1 >= args.length) return null
  return args[idx + 1]
}

const keyFile   = getArg('--key-file')
const keyId     = getArg('--key-id')
const teamId    = getArg('--team-id')
const serviceId = getArg('--service-id') || 'com.rdennis.kanjilearn2.signin'

if (!keyFile || !keyId || !teamId) {
  console.error(`
Usage:
  node scripts/generate-apple-client-secret.js \\
    --key-file ./AuthKey_XXXXXXXX.p8 \\
    --key-id YOUR_KEY_ID \\
    --team-id YOUR_TEAM_ID \\
    --service-id com.rdennis.kanjilearn2.signin
`)
  process.exit(1)
}

// ── Read private key ─────────────────────────────────────────────────────────

const privateKey = fs.readFileSync(keyFile, 'utf8')

// ── Build JWT ────────────────────────────────────────────────────────────────

function base64url(obj) {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj)
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

const now = Math.floor(Date.now() / 1000)
const SIX_MONTHS = 15777000 // ~6 months in seconds

const header = {
  alg: 'ES256',
  kid: keyId,
}

const payload = {
  iss: teamId,
  iat: now,
  exp: now + SIX_MONTHS,
  aud: 'https://appleid.apple.com',
  sub: serviceId,
}

const signingInput = base64url(header) + '.' + base64url(payload)

const sign = crypto.createSign('SHA256')
sign.update(signingInput)
const signature = sign.sign(privateKey)

// ES256 signature is DER-encoded — convert to raw r||s (64 bytes)
function derToRaw(derSig) {
  // DER: 0x30 <len> 0x02 <rLen> <r> 0x02 <sLen> <s>
  let offset = 2 + (derSig[1] > 128 ? derSig[1] - 128 : 0)
  const rLen = derSig[offset + 1]
  const r = derSig.subarray(offset + 2, offset + 2 + rLen)
  offset += 2 + rLen
  const sLen = derSig[offset + 1]
  const s = derSig.subarray(offset + 2, offset + 2 + sLen)

  // Pad/trim to 32 bytes each
  const rPad = Buffer.alloc(32)
  r.copy(rPad, 32 - r.length > 0 ? 32 - r.length : 0, r.length > 32 ? r.length - 32 : 0)
  const sPad = Buffer.alloc(32)
  s.copy(sPad, 32 - s.length > 0 ? 32 - s.length : 0, s.length > 32 ? s.length - 32 : 0)

  return Buffer.concat([rPad, sPad])
}

const rawSig = derToRaw(signature)
const jwt = signingInput + '.' + base64url(rawSig.toString('binary'))

// ── Output ───────────────────────────────────────────────────────────────────

console.log('\n=== Apple Client Secret JWT ===\n')
console.log(jwt)
console.log('\nExpires:', new Date((now + SIX_MONTHS) * 1000).toISOString())
console.log('\nPaste this into Supabase → Authentication → Providers → Apple → Secret Key\n')
