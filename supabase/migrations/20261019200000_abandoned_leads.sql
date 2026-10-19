-- Abandoned checkout pipeline: two reminder emails, then the row becomes a lead.
-- lead_emails: 0 none sent, 1 after the 30 minute email (webhook), 2 after the day 2 email (cron).
-- recovery_url: Stripe's 30 day resume link from checkout.session.expired, reused by the day 2 email.
alter table public.bookings
  add column if not exists lead_emails smallint not null default 0,
  add column if not exists recovery_url text;
