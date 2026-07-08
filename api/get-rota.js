// api/get-rota.js
// Public endpoint — returns the admin-published availability rota so the homepage
// calendar reflects live edits. No auth (it only exposes available dates/times).
// If nothing has been published yet, returns { rota: null } and the site falls
// back to the rota built into index.html.

import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { data, error } = await supabase
      .from('site_config')
      .select('value')
      .eq('key', 'rota')
      .maybeSingle();
    if (error) throw error;
    return res.status(200).json({ rota: data ? data.value : null });
  } catch (err) {
    console.error('get-rota error:', err);
    // Non-fatal: the site falls back to its built-in rota.
    return res.status(200).json({ rota: null });
  }
}
