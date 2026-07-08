// api/availability.js
// One endpoint for all availability operations — keeps the Serverless Function
// count low (replaces get-rota.js, save-rota.js and block-slots.js).
//
//   GET                         -> { rota }            (public: published rota)
//   POST {action:'save-rota'}   -> save rota           (admin)
//   POST {action:'blocks'}      -> block/release slots (admin)
//
// Slots are written to the same `blocked_slots` table get-slots reads, and the rota
// to site_config['rota'] which get(...) returns to the public homepage.

import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ---- Public read: the admin-published rota ----
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
    try {
      const { data, error } = await supabase
        .from('site_config').select('value').eq('key', 'rota').maybeSingle();
      if (error) throw error;
      return res.status(200).json({ rota: data ? data.value : null });
    } catch (err) {
      console.error('availability GET error:', err);
      return res.status(200).json({ rota: null }); // non-fatal: site falls back to built-in rota
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, action, rota, block, release } = req.body || {};
  if (!verifyAdminToken(token)) return res.status(401).json({ error: 'Unauthorised' });

  try {
    // ---- Save the availability rota ----
    if (action === 'save-rota') {
      if (!rota || typeof rota !== 'object' || Array.isArray(rota)) {
        return res.status(400).json({ error: 'Invalid rota payload' });
      }
      const { error } = await supabase
        .from('site_config')
        .upsert({ key: 'rota', value: rota, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      return res.status(200).json({ success: true, days: Object.keys(rota).length });
    }

    // ---- Block / release specific slots ----
    if (action === 'blocks') {
      const clean = (arr) => (Array.isArray(arr) ? arr : [])
        .filter(s => s && s.date && s.time)
        .map(s => ({ booking_date: s.date, slot_time: s.time }));
      const toBlock = clean(block);
      const toRelease = clean(release);

      if (toBlock.length) {
        const { error } = await supabase
          .from('blocked_slots')
          .upsert(toBlock.map(r => ({ ...r, booking_id: null })),
                  { onConflict: 'booking_date,slot_time', ignoreDuplicates: true });
        if (error) throw error;
      }
      for (const r of toRelease) {
        const { error } = await supabase
          .from('blocked_slots').delete()
          .eq('booking_date', r.booking_date).eq('slot_time', r.slot_time);
        if (error) throw error;
      }
      return res.status(200).json({ success: true, blocked: toBlock.length, released: toRelease.length });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('availability POST error:', err);
    return res.status(500).json({ error: err.message });
  }
}
