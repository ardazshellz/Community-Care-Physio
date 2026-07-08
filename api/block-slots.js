// api/block-slots.js
// Admin-only: block or release specific calendar slots directly, for appointments
// that don't come through Stripe (manually scheduled package follow-ups, reschedules).
//
// Writes to the SAME `blocked_slots` table that get-slots.js reads and stripe-webhook
// writes to, so anything blocked here disappears from the public homepage for everyone,
// and anything released reappears. Only Cancelled/DNA/reschedule-away should release.
//
// Body: { token, block: [{date,time}], release: [{date,time}] }
//   block   -> upsert rows into blocked_slots  (slot becomes unavailable publicly)
//   release -> delete rows from blocked_slots  (slot becomes available again)

import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, block, release } = req.body || {};
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const clean = (arr) => (Array.isArray(arr) ? arr : [])
    .filter(s => s && s.date && s.time)
    .map(s => ({ booking_date: s.date, slot_time: s.time }));

  const toBlock = clean(block);
  const toRelease = clean(release);

  try {
    // Block: upsert so re-blocking the same slot is a no-op (matches the unique
    // constraint on booking_date + slot_time used by the webhook).
    if (toBlock.length) {
      const { error } = await supabase
        .from('blocked_slots')
        .upsert(
          toBlock.map(r => ({ ...r, booking_id: null })),
          { onConflict: 'booking_date,slot_time', ignoreDuplicates: true }
        );
      if (error) throw error;
    }

    // Release: delete each freed slot.
    for (const r of toRelease) {
      const { error } = await supabase
        .from('blocked_slots')
        .delete()
        .eq('booking_date', r.booking_date)
        .eq('slot_time', r.slot_time);
      if (error) throw error;
    }

    return res.status(200).json({ success: true, blocked: toBlock.length, released: toRelease.length });
  } catch (err) {
    console.error('block-slots error:', err);
    return res.status(500).json({ error: err.message });
  }
}
