# Service inventory
Verified through read-only connector calls on 15 September 2026.

| Service | Verified identity | Status / limits |
|---|---|---|
| GitHub | ardazshellz/Community-Care-Physio; repository ID 1232419123; public; default main | Connector metadata and git clone succeeded |
| Supabase | community-care-physio; project ref gcqmuqsjqpligzhmgktc; organisation ccicceovdgaalrjytpxr; eu-west-1 | ACTIVE_HEALTHY; PostgreSQL 17; public.bookings, blocked_slots, pending_bookings, site_config have RLS enabled; no Edge Functions listed |
| Stripe | Community Care Physio; acct_1TUlNLHiAT0DuJnT; live mode | Account listing succeeded; no transactions, customers, keys, products or webhook configuration retrieved |
| Vercel | Deployment identity unverified | list_teams returned empty; historical team_1r0GROqXrDhI8sh3XxNr6jRp failed listing and project lookup returned 403. That historical scope came from a different website and is not confirmed for this one |
| Website | https://www.communitycarephysio.co.uk/ | Public homepage retrieved; deployment commit and backend operation not established |
| ChatGPT | No Community Care Physio project in accessible project list | In-app browser is logged out; Project not created |
| Codex | Local Git checkout exists | No callable saved-project registration tool; folder not registered as a saved Codex project |
| Claude | Portable instructions provided | No Claude connector/history export inspected; local folder access must be granted by user |

Environment variable names detected in server code (values deliberately excluded):
- ADMIN_PASSWORD_HASH
- ADMIN_SALT
- CRON_SECRET
- GMAIL_APP_PASSWORD
- RESEND_API_KEY
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_URL

No schema dump, patient rows, payment records, secret values or private contact details were exported. RLS presence alone does not establish policy correctness. Production environment presence and settings remain unverified.
