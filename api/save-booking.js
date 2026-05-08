// api/save-booking.js
// Called directly when patient clicks Pay
// Saves booking to Supabase + sends emails immediately
// No webhook needed

import { supabase } from '../lib/supabase.js';

function getBlockedSlots(timeStr, durationMins) {
  const [h, m] = timeStr.split(':').map(Number);
  const startMins = h * 60 + m;
  const totalBlock = durationMins + 45; // + 45min travel buffer
  const blocked = [];
  for (let t = 0; t < totalBlock; t += 30) {
    const slotMins = startMins + t;
    const sh = Math.floor(slotMins / 60);
    const sm = slotMins % 60;
    if (sh < 24) blocked.push(`${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`);
  }
  return blocked;
}

function getDurationMins(appt) {
  const map = {
    'Initial Assessment':60,'Standard Session':45,'Extended Session':60,
    'Starter Programme':60,'Full Programme':60,
    'Block of 4 Sessions':45,'Block of 6 Sessions':45
  };
  return map[appt] || 60;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const bd = req.body;

    // Save booking to Supabase
    const { data: booking, error } = await supabase
      .from('bookings')
      .insert({
        name: bd.name,
        phone: bd.phone,
        email: bd.email,
        address: bd.address,
        postcode: bd.postcode,
        appointment: bd.appointment,
        duration: bd.duration,
        price: bd.price,
        booked_date: bd.bookedDate || null,
        booked_time: bd.bookedTime || null,
        preferred_time: bd.preferredTime,
        area: bd.area,
        patient_type: bd.patientType,
        booking_for: bd.bookingFor,
        reason: bd.reason,
        preferred_days: bd.preferredDays,
        paid: false, // will confirm manually or via webhook later
        confirmed: false,
        timestamp: bd.timestamp || new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })
      })
      .select()
      .single();

    if (error) throw error;

    // Block the slot + travel buffer
    if (bd.bookedDate && bd.bookedTime) {
      const durationMins = getDurationMins(bd.appointment);
      const slotsToBlock = getBlockedSlots(bd.bookedTime, durationMins);
      await supabase
        .from('blocked_slots')
        .upsert(
          slotsToBlock.map(slot => ({
            booking_date: bd.bookedDate,
            slot_time: slot,
            booking_id: booking.id
          })),
          { onConflict: 'booking_date,slot_time', ignoreDuplicates: true }
        );
    }

    // Send emails via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const formattedDate = bd.bookedDate
        ? new Date(bd.bookedDate + 'T12:00:00').toLocaleDateString('en-GB', {
            weekday:'long', day:'numeric', month:'long', year:'numeric'
          })
        : 'TBC';
      const formattedTime = bd.bookedTime || bd.preferredTime || 'TBC';

      // Email to Zakery
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'CCP Bookings <onboarding@resend.dev>',
          to: 'infoccphysio@gmail.com',
          subject: `🗓 New booking — ${bd.appointment} · ${bd.name} · ${formattedDate}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px">
            <div style="background:#1e4d3b;padding:20px;border-radius:10px 10px 0 0">
              <h2 style="color:#fff;margin:0">New booking ✅</h2>
              <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0">Payment pending — patient redirected to Stripe</p>
            </div>
            <div style="background:#fff;padding:24px;border:1px solid #e8f2ee;border-top:none;font-size:13px;line-height:1.8">
              <p><strong>Name:</strong> ${bd.name}</p>
              <p><strong>Phone:</strong> <a href="tel:${bd.phone}">${bd.phone}</a></p>
              <p><strong>Email:</strong> ${bd.email || '—'}</p>
              <p><strong>Address:</strong> ${bd.address || '—'}, ${bd.postcode || ''}</p>
              <p><strong>Appointment:</strong> ${bd.appointment} (${bd.duration})</p>
              <p><strong>Date:</strong> ${formattedDate}</p>
              <p><strong>Time:</strong> <strong style="color:#1e4d3b">${formattedTime}</strong></p>
              <p><strong>Patient type:</strong> ${bd.patientType === 'new' ? '🆕 New patient' : '🔄 Returning patient'}</p>
              ${bd.reason ? `<p><strong>Reason:</strong> ${bd.reason}</p>` : ''}
              <p><strong>Amount:</strong> £${bd.price}</p>
              <div style="margin-top:16px;padding:12px;background:#e8f2ee;border-radius:8px;font-size:12px;color:#1e4d3b">
                <a href="https://communitycarephysio.co.uk/#admin" style="color:#1e4d3b;font-weight:600">View in admin →</a>
                &nbsp;·&nbsp; Mark as paid once Stripe confirms
              </div>
            </div>
          </div>`
        })
      }).catch(e => console.error('Admin email error:', e));

      // Confirmation email to patient
      if (bd.email) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Community Care Physio <onboarding@resend.dev>',
            to: bd.email,
            subject: `Booking request received — ${bd.appointment} · ${formattedDate}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
              <div style="background:#1e4d3b;padding:24px;border-radius:12px 12px 0 0">
                <h1 style="color:#fff;font-size:20px;margin:0">Community Care Physio</h1>
                <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0">South West London</p>
              </div>
              <div style="background:#fff;padding:28px;border:1px solid #e8f2ee;border-top:none">
                <h2 style="color:#1e4d3b;font-size:18px">Booking received 👋</h2>
                <p style="font-size:14px;color:#586860;line-height:1.6">Hi ${bd.name?.split(' ')[0] || 'there'},<br><br>
                We've received your booking request. Once your payment is confirmed via Stripe, your appointment will be confirmed.</p>
                <div style="background:#e8f2ee;border-radius:10px;padding:18px;margin:20px 0;font-size:13px">
                  <p style="margin:0 0 6px"><strong>Appointment:</strong> ${bd.appointment}</p>
                  <p style="margin:0 0 6px"><strong>Date:</strong> ${formattedDate}</p>
                  <p style="margin:0 0 6px"><strong>Time:</strong> ${formattedTime}</p>
                  <p style="margin:0 0 6px"><strong>Address:</strong> ${bd.address || ''}, ${bd.postcode || ''}</p>
                  <p style="margin:0"><strong>Amount:</strong> £${bd.price}</p>
                </div>
                <p style="font-size:13px;color:#586860;line-height:1.6">
                  Please wear comfortable clothing. If you have any relevant medical letters or scan results, have them ready.
                </p>
                <p style="font-size:12px;color:#8aab97;margin-top:20px;padding-top:16px;border-top:1px solid #e8f2ee">
                  Questions? WhatsApp <strong>07508 401627</strong> or email <strong>infoccphysio@gmail.com</strong>
                </p>
              </div>
            </div>`
          })
        }).catch(e => console.error('Patient email error:', e));
      }
    }

    return res.status(200).json({ success: true, bookingId: booking.id });

  } catch (err) {
    console.error('save-booking error:', err);
    return res.status(500).json({ error: err.message });
  }
}
