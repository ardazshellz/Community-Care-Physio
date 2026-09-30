// api/admin-login.js
// Checks the password ONCE against your existing ADMIN_PASSWORD_HASH / ADMIN_SALT
// setup, then issues a signed session token so the password itself doesn't need
// to be sent again on every admin action.

import { verifyPassword, issueAdminToken } from '../lib/adminAuth.js';
import { createHash } from 'node:crypto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function logLimitError(error) {
  const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,40}$/i.test(error.code) ? error.code : 'unknown';
  console.error('admin-login', { code });
}

export function createAdminLoginHandler({ db, verify = verifyPassword, issue = issueAdminToken } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { password } = req.body || {};
    const realIp = req.headers?.['x-real-ip'];
    const forwarded = req.headers?.['x-forwarded-for'];
    const ip = (Array.isArray(realIp) ? realIp[0] : realIp)?.trim() ||
      (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() || 'unknown';
    const key = `counter:login:${createHash('sha256').update(`${ip}:${process.env.ADMIN_SALT}`).digest('hex')}`;
    let failures = 0;
    let database;
    try {
      database = db || (await import('../lib/supabase.js')).supabase;
      const { data: record, error } = await database.from('practice_records').select('value').eq('key', key).maybeSingle();
      if (error) throw error;
      if (record && Date.now() - Date.parse(record.value.lastFailure) <= WINDOW_MS) {
        failures = Number(record.value.failures) || 0;
      }
      if (failures >= MAX_FAILURES) {
        return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
      }
    } catch (error) {
      logLimitError(error);
    }

    if (!verify(password)) {
      failures++;
      if (database) {
        try {
          const now = new Date().toISOString();
          const { error } = await database.from('practice_records').upsert({
            key, kind: 'counter', value: { failures, lastFailure: now }, updated_at: now
          }, { onConflict: 'key' });
          if (error) throw error;
        } catch (error) {
          logLimitError(error);
        }
      }
      return res.status(401).json({ error: 'Incorrect password', attemptsLeft: Math.max(0, MAX_FAILURES - failures) });
    }

    if (database) {
      try {
        const { error } = await database.from('practice_records').delete().eq('key', key);
        if (error) throw error;
      } catch (error) {
        logLimitError(error);
      }
    }

    const { token, expiresAt } = issue();
    return res.status(200).json({ success: true, token, expiresAt });
  };
}

export default createAdminLoginHandler();
