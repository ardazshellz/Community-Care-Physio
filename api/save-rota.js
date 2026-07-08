// api/save-rota.js
// Admin-only. Saves the availability rota (date -> [times]) to Supabase so the
// public homepage calendar reads it live (via get-rota) — no GitHub deploy needed.

import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, rota } = req.body || {};
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  if (!rota || typeof rota !== 'object' || Array.isArray(rota)) {
    return res.status(400).json({ error: 'Invalid rota payload' });
  }

  try {
    const { error } = await supabase
      .from('site_config')
      .upsert({ key: 'rota', value: rota, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return res.status(200).json({ success: true, days: Object.keys(rota).length });
  } catch (err) {
    console.error('save-rota error:', err);
    return res.status(500).json({ error: err.message });
  }
}
