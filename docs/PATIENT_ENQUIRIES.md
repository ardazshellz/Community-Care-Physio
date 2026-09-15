# Patient enquiries — implementation and release notes

15 September 2026. Branch: `feature/patient-enquiries`, based on main `e9defdf7a25594ad22b436d4a01af9a1a9805a97`. Feature commit `daf34bf` built successfully on Vercel Preview. Following explicit user consent, the production Supabase migration was applied and its table/function verified. No real payment or message has been sent. Stripe event configuration and production website publication are being completed.

## Incomplete package archive correction

Outstanding sessions now override stale package completion flags and timestamps. Unbooked/cancelled visits are no longer omitted from the completion test, missing purchased sessions receive unscheduled placeholders, and the dashboard, patient list and review selection use session-based completion. Completed visits remain completed. An old browser submitting stale completion metadata is also corrected by the save-sessions API. The affected existing record was checked using only its package/session states; its stale timestamp is to be cleared after the fixed server is published. No patient identity or contact details are included in this handover or tests.

25 automated tests pass, including seven archive regressions with synthetic data in addition to the enquiry tests below. Vercel browser login works for project `prj_8vBZj1Ble9dG8FL1HUn0Fsmmh1UZ` in team `team_1r0GROqXrDhI8sh3XxNr6jRp`; connector access still fails. Required environment names are present in Production and Preview. The applied enquiry table intentionally has no anon/authenticated RLS policies or grants; only the service role can use it.

## What the administrator can do

Open **Patient enquiries** from the admin navigation, dashboard card or Generate Emails section. Save a name, contact preference, email/mobile, visit address, optional needs, goals and proposed approach. A name is enough to save a query patient; contact details are required before recording a message as sent.

The visual progress strip follows Query patient → Introduction sent → Appointment agreed → Payment requested → Confirmed patient. Generate and edit the introduction, open a Gmail or WhatsApp draft, send it yourself, then select **I have sent this message**. This records your action and the exact saved message; it does not assert delivery, identity verification or that the patient has read it.

Enter an agreed date/time in UK time and a whole-pound fee (£10–£5,000). This version is for one 60-minute initial assessment, with travel time reserved. Create the payment request and edit the follow-up below it. Reusing an existing link preserves an edited draft. Closing an unpaid link permits rearrangement; an in-flight payment cannot be closed until Stripe reports an outcome.

Verified payment promotes the booking into the existing dashboard and patient list exactly once. A confirmation draft is then available. Messages are sent by the clinician in Gmail/WhatsApp; there is no automated WhatsApp delivery integration. Contact and appointment details are fixed during an active payment request; saved messages remain editable.

## Implementation

- `assets/enquiries.js`, `assets/enquiries.css`: browser workflow, editable templates, history, save/conflict handling, existing admin authentication, selected-record payment refresh every 30 seconds. Patient enquiry state is not placed in localStorage.
- `api/get-bookings.js`: existing authenticated POST endpoint dispatches `action: enquiries` and the operation to `lib/enquiries.js`. Unpaid enquiry bookings are excluded from the normal patient/dashboard output. No additional Vercel function was added.
- `lib/enquiry-model.js`: field validation and UK/international WhatsApp number normalization.
- `lib/enquiries.js`: versioned database commands, persisted idempotent Checkout attempts, trusted Stripe status reconciliation, expiry/cancellation and asynchronous payment handling. Stripe metadata contains internal enquiry, attempt and booking IDs rather than clinical notes.
- `supabase/migrations/20260915182533_patient_enquiries.sql`: private RLS table and SECURITY INVOKER RPC, optimistic versions, transaction-safe reservations and promotion, reservation protection for incoming public pending holds. Only the service role receives enquiry access.
- `api/create-checkout.js`: public Checkout expires after 31 minutes; its pending hold lasts one minute longer. A failed pending hold aborts before creating a payment URL. Previously the hold expired after five minutes while the payment session could remain payable.
- `api/stripe-webhook.js`: enquiry branch validates signed events, retrieves the authoritative Checkout Session, promotes transactionally or returns an error for Stripe to retry.
- `index.html`: admin entry points and a startup ordering fix so a saved login can reload without referencing booking constants before initialization. `admin.html` links to the full workflow.

## Verification completed locally

`npm test`: 18 tests passing. These execute the migration and RPC against PGlite PostgreSQL using synthetic schema fixtures checked against read-only production schema metadata. Coverage includes access restrictions, stale writes, required introduction, reservations, overlap rejection in both directions, repeated Checkout requests, delayed payments, amount/currency/session mismatch, expiry, replacement links, failed payments, timeout recovery, transactional rollback, invalid admin credentials and forged webhook signatures.

Browser checks with fictional data exercised enquiry saving, introduction generation, sent-history recording, payment follow-up generation, a simulated payment, promotion into the patient list, correct appointment date display, WhatsApp preference, draft persistence after reload and preservation of edited text when reusing a payment link. No external draft was submitted. Static JavaScript and inline-script syntax checks passed.

The local preview uses an in-memory database and fake Stripe; it is not a real Stripe test-mode or Supabase staging integration test. The preview adapter normalizes PGlite date values to the date-only format returned by Supabase. Its server and synthetic fixtures live under the parent `work/` directory and are excluded from deployable application code.

## Release checklist and remaining limits

Follow-up verification: the connected live Stripe account has an enabled webhook at `https://www.communitycarephysio.co.uk/api/stripe-webhook`, subscribed to `checkout.session.completed`, `charge.succeeded` and `payment_intent.succeeded`. Add the asynchronous success/failure and expiry events listed below as part of rollout. The live Supabase enquiry table/RPC are still absent, and no staging branches were listed. Vercel connector team discovery remains empty; the saved CLI login also returns HTTP 403 `forbidden` / `Not authorized`. Browser access leads to Vercel login. These findings do not identify the underlying account/permission cause. No production settings were changed.

The admin Dashboard and Patients views now also refresh every 30 seconds while visible and signed in, regardless of whether an enquiry is selected. Concurrent syncs are suppressed and late responses from a previous login are ignored.

1. Obtain access to the correct Vercel project. Current connector attempts returned no teams / 403; project, live environment and current deployment are unverified. Production changes require explicit scope under AGENTS.md.
2. Review the diff and apply the migration to isolated Supabase staging first. It assumes the existing `bookings`, `blocked_slots` and `pending_bookings` tables and their current columns. Enable a supported Node runtime (package requires Node >=22); install with `npm ci`.
3. Configure staging with test-mode Stripe and an isolated database. Existing server variables are SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ADMIN_PASSWORD_HASH and ADMIN_SALT. Do not put values in handovers or browser code.
4. Configure `/api/stripe-webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Test actual Checkout, duplicate/reordered webhooks, delayed payment, expiry, cancellation and UK-time dates in staging. Also smoke-test the existing checkout and SMTP flows after the Stripe SDK/Supabase dependency updates.
5. Before enabling in production, reconcile still-payable sessions from the previous public checkout and legacy admin payment-link generator. Old sessions are not retroactively shortened. The legacy custom payment-link generator still has best-effort holds and is outside this enquiry workflow; its availability enforcement needs separate hardening before claiming every booking route is concurrency-safe.
6. A Stripe creation timeout retains the reservation rather than risking a second chargeable link. Use Recover payment link / Check payment status while the persisted attempt is current. If recovery is unavailable after expiry or Stripe's idempotency retention window, an operator must reconcile Stripe and the stored attempt before releasing the hold; never manually mark it paid. Webhook failures must be monitored and replayed.
7. `npm audit` reports one high-severity dependency entry for the existing Nodemailer 6 dependency. The offered remediation is a major upgrade; it was not folded into this feature. Assess and upgrade the existing SMTP integration before production sign-off. This enquiry feature itself opens clinician-reviewed Gmail/WhatsApp drafts.
8. The enquiry list currently loads the most recent 500 records. There is no archiving/pagination UI yet. Payment/refund disputes and post-payment appointment amendments use existing patient controls; they are not a new accounting/reconciliation feature.

Deploy only after staging verification and approval. Rollback should disable enquiry creation and preserve the new table, payment references and webhook settlement path until all issued sessions are reconciled; do not drop data as a rollback shortcut.
