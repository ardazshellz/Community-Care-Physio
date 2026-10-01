import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let pg;
const day = '2030-03-04';
const hold = (id, time, appointment = 'Initial Assessment', mins = 30) => pg.query(
  `insert into pending_bookings(stripe_session_id, booking_data, booked_date, booked_time, expires_at)
   values ($1, $2::jsonb, $3, $4, now() + make_interval(mins => $5))`,
  [id, JSON.stringify({ appointment }), day, time, mins]
);
const rejects = (p, re) => assert.rejects(p, (e) => re.test(e.message));

before(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table bookings(id uuid primary key default gen_random_uuid());
    create table blocked_slots(id uuid primary key default gen_random_uuid(), booking_date date not null, slot_time text not null,
      booking_id uuid references bookings(id), unique(booking_date, slot_time));
    create table pending_bookings(id uuid primary key default gen_random_uuid(), stripe_session_id text not null unique,
      booking_data jsonb not null, booked_date date, booked_time text, expires_at timestamptz);
  `);
  await pg.exec(await readFile(new URL('../supabase/migrations/20261001120000_slot_overlap_guard.sql', import.meta.url), 'utf8'));
});
after(async () => pg.close());
beforeEach(async () => pg.exec('delete from pending_bookings; delete from blocked_slots;'));

test('a hold that runs into a blocked slot (visit + 45 min buffer) is rejected', async () => {
  await pg.query(`insert into blocked_slots(booking_date, slot_time) values ($1, '18:30')`, [day]);
  await rejects(hold('a', '18:00'), /overlaps a booked slot/);         // 18:00–19:45 covers 18:30
  await rejects(hold('b', '17:30'), /overlaps a booked slot/);         // 17:30–19:15 covers 18:30
  await hold('c', '16:30');                                            // 16:30–18:15 ends before 18:30
  await hold('d', '18:00', 'Standard Session', 30).catch(() => {});    // 45 min: 18:00–19:30 still covers 18:30
  const { rows } = await pg.query('select stripe_session_id from pending_bookings order by 1');
  assert.deepEqual(rows.map((r) => r.stripe_session_id), ['c']);
});

test('two live holds cannot overlap; expired holds and the same hold do not block', async () => {
  await hold('first', '18:30');
  await rejects(hold('second', '18:00'), /overlaps a reserved slot/);  // new range reaches 18:30
  await rejects(hold('third', '19:30'), /overlaps a reserved slot/);   // first runs until 20:15
  await hold('fourth', '20:30');                                       // starts after 20:15
  await hold('first', '18:30').catch(() => {});                        // duplicate id: unique error, not overlap
  await pg.query(`update pending_bookings set expires_at = now() - interval '1 minute' where stripe_session_id = 'first'`);
  await hold('fifth', '18:00');                                        // expired hold no longer reserves
  const { rows } = await pg.query(`select count(*)::int as n from pending_bookings`);
  assert.equal(rows[0].n, 3);
});

test('upserting the same hold again (same stripe_session_id) does not clash with itself', async () => {
  await hold('same', '18:00');
  await pg.query(`update pending_bookings set expires_at = now() + interval '40 minutes' where stripe_session_id = 'same'`);
  const { rows } = await pg.query(`select count(*)::int as n from pending_bookings`);
  assert.equal(rows[0].n, 1);
});
