// Only bookings the patient has paid for, or the admin has confirmed or
// invoiced, earn a reminder. An unpaid checkout (paid:false, confirmed:false,
// status null) holds a slot for a short while but must never be reminded;
// the cron sweeps it into an abandoned lead instead.
export function isSecured(b) {
  return !!b && (b.paid === true || b.confirmed === true);
}
