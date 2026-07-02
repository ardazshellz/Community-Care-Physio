// api/admin-login.js
// Checks the password ONCE against your existing ADMIN_PASSWORD_HASH / ADMIN_SALT
// setup, then issues a signed session token so the password itself doesn't need
// to be sent again on every admin action.

import { verifyPassword, issueAdminToken } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};

  if (!verifyPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const { token, expiresAt } = issueAdminToken();
  return res.status(200).json({ success: true, token, expiresAt });
}
