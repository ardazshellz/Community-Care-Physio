// lib/adminAuth.js
// Matches the existing password scheme already used in get-bookings.js
// (SHA-256 + ADMIN_SALT, checked against ADMIN_PASSWORD_HASH).
// Adds one improvement: after the password is checked ONCE at login,
// every other admin action uses a short-lived signed token instead of
// re-sending the password on every single request.

import crypto from 'crypto';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + process.env.ADMIN_SALT).digest('hex');
}

// Reuses the existing password hash as the token-signing secret — it's
// already a high-entropy, server-only value, so no new env var is needed.
function getSigningSecret() {
  const secret = process.env.ADMIN_PASSWORD_HASH;
  if (!secret) throw new Error('Missing ADMIN_PASSWORD_HASH environment variable');
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadStr) {
  return crypto.createHmac('sha256', getSigningSecret()).update(payloadStr).digest('base64url');
}

// Same check as get-bookings.js currently does inline — now shared in one place.
export function verifyPassword(password) {
  const expected = process.env.ADMIN_PASSWORD_HASH;
  if (!password || !expected) return false;
  const actual = hashPassword(password);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Issues a signed, time-limited token after a successful password check.
export function issueAdminToken() {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = JSON.stringify({ exp: expiresAt });
  const payloadB64 = base64url(payload);
  const sig = sign(payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt };
}

// Verifies a token sent from the admin panel on every protected API call.
export function verifyAdminToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payloadB64, sig] = token.split('.');
  let expectedSig;
  try {
    expectedSig = sign(payloadB64);
  } catch {
    return false;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}
