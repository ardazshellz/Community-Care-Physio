// api/create-payment-link.js
// Admin-only: generates a Stripe Payment Link for a custom amount (e.g. a bespoke
// block of follow-up sessions). Protected by the admin session token — a patient
// can never call this. Returns a payment URL the admin drops into an email.
//
// This does NOT charge anyone automatically. It creates a link the patient must
// click and pay themselves, exactly like a normal Stripe checkout.

import Stripe from 'stripe';
import { verifyAdminToken } from '../lib/adminAuth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Hard safety bounds so a bug or typo can never create an absurd charge.
const MIN_PENCE = 1000;    // £10 floor
const MAX_PENCE = 500000;  // £5,000 ceiling

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, amount, description } = req.body || {};

  // 1. Auth — admin only
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // 2. Validate amount (expects pounds, converts to pence)
  const pence = Math.round(Number(amount) * 100);
  if (!Number.isFinite(pence) || pence < MIN_PENCE || pence > MAX_PENCE) {
    return res.status(400).json({ error: `Amount must be between £${MIN_PENCE/100} and £${MAX_PENCE/100}` });
  }

  const desc = (typeof description === 'string' && description.trim())
    ? description.trim().slice(0, 250)
    : 'Community Care Physio — treatment sessions';

  try {
    // 3. Create a one-off price for this exact amount
    const price = await stripe.prices.create({
      currency: 'gbp',
      unit_amount: pence,
      product_data: { name: desc },
    });

    // 4. Create a payment link pointing at that price
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      after_completion: {
        type: 'redirect',
        redirect: { url: 'https://communitycarephysio.co.uk/?booking=success' },
      },
    });

    return res.status(200).json({ success: true, url: link.url, amount: pence / 100 });
  } catch (err) {
    console.error('create-payment-link error:', err);
    return res.status(500).json({ error: err.message });
  }
}
