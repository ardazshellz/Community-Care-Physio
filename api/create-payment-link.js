// api/create-payment-link.js
// Admin-only: generates a Stripe Payment Link for a custom booking (e.g. a bespoke
// block of follow-up sessions), AND creates a matching booking record in Supabase.
// The booking's ID is attached to the payment link metadata so that when the patient
// pays, the existing stripe-webhook picks it up: marks it paid, blocks the slots,
// and sends the patient a payment-received confirmation email — like a normal booking.
//
// Protected by the admin session token — a patient can never call this.
// This does NOT charge anyone automatically; the patient clicks the link and pays.

import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const MIN_PENCE = 1000;    // £10 floor
const MAX_PENCE = 500000;  // £5,000 ceiling

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, amount, description, patient, sessions } = req.body || {};

  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const pence = Math.round(Number(amount) * 100);
  if (!Number.isFinite(pence) || pence < MIN_PENCE || pence > MAX_PENCE) {
    return res.status(400).json({ error: `Amount must be between £${MIN_PENCE/100} and £${MAX_PENCE/100}` });
  }

  const desc = (typeof description === 'string' && description.trim())
    ? description.trim().slice(0, 250)
    : 'Community Care Physio — treatment sessions';

  const sess = Array.isArray(sessions) ? sessions : [];
  const first = sess[0] || {};

  try {
    // Create the booking record (unpaid until the webhook fires)
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .insert({
        name: patient?.name || 'Custom booking',
        phone: patient?.phone || '',
        email: patient?.email || '',
        address: patient?.address || '',
        postcode: patient?.postcode || '',
        appointment: desc,
        price: pence / 100,
        booked_date: first.date || null,
        booked_time: first.time || null,
        preferred_time: sess.map(s => `${s.date} ${s.time}`).join(', '),
        patient_type: 'returning',
        booking_for: 'custom',
        reason: `Custom booking — ${sess.length} session(s)`,
        custom_sessions: JSON.stringify(sess),
        paid: false,
        confirmed: false,
        timestamp: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })
      })
      .select()
      .single();

    if (bookingErr) throw bookingErr;

    // ── 48-HOUR SLOT HOLD ──
    // Hold every session's slot immediately so no one else can book it while the
    // patient pays. get-slots already blocks pending_bookings whose expires_at is
    // still in the future, so this makes the hold appear on everyone's homepage.
    // Best-effort: wrapped so that if the insert fails (e.g. a column name differs
    // in your pending_bookings table) the payment link STILL generates — it can
    // never break booking creation. If holds don't appear, check the column names
    // below against your Supabase `pending_bookings` table.
    try {
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const holds = sess
        .filter(s => s && s.date && s.time)
        .map(s => ({
          booked_date: s.date,
          booked_time: s.time,
          expires_at: expiresAt,
          booking_id: booking.id,
          name: patient?.name || 'Custom booking'
        }));
      if (holds.length) {
        const { error: holdErr } = await supabase.from('pending_bookings').insert(holds);
        if (holdErr) console.warn('pending hold insert failed (non-fatal):', holdErr.message);
      }
    } catch (holdErr) {
      console.warn('pending hold insert threw (non-fatal):', holdErr?.message);
    }

    const price = await stripe.prices.create({
      currency: 'gbp',
      unit_amount: pence,
      product_data: { name: desc },
    });

    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      after_completion: {
        type: 'redirect',
        redirect: { url: `https://communitycarephysio.co.uk/?booking=success&id=${booking.id}` },
      },
      metadata: { booking_id: booking.id, custom: 'true' },
      payment_intent_data: { metadata: { booking_id: booking.id, custom: 'true' } },
    });

    return res.status(200).json({ success: true, url: link.url, amount: pence / 100, bookingId: booking.id });
  } catch (err) {
    console.error('create-payment-link error:', err);
    return res.status(500).json({ error: err.message });
  }
}
