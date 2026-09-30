import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAdminLoginHandler } from '../api/admin-login.js';
import { fakeDb, response } from './safety-helpers.js';

function setup(db = fakeDb()) {
  let verified = 0;
  const handler = createAdminLoginHandler({ db,
    verify(password) { verified++; return password === 'correct'; },
    issue() { return { token: 'test-token', expiresAt: 123 }; }
  });
  return { db, get verified() { return verified; }, async login(password = 'wrong', headers = { 'x-real-ip': '192.0.2.1' }) {
    const res = response(); await handler({ method: 'POST', headers, body: { password } }, res); return res;
  } };
}

test('five failures persist and the next request is blocked without password verification', async () => {
  const ctx = setup();
  for (let i = 1; i <= 5; i++) {
    const res = await ctx.login();
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Incorrect password', attemptsLeft: 5 - i });
  }
  const res = await setup(ctx.db).login('correct');
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'Too many attempts. Please wait 15 minutes and try again.');
  await ctx.login('correct');
  assert.equal(ctx.verified, 5);
  assert.equal(ctx.db.tables.practice_records[0].kind, 'counter');
  const persisted = JSON.stringify(ctx.db.tables);
  assert.ok(!persisted.includes('192.0.2.1'));
  assert.ok(!persisted.includes('wrong'));
});

test('success clears the counter and a later failure starts at four attempts left', async () => {
  const ctx = setup(); await ctx.login(); await ctx.login();
  const res = await ctx.login('correct');
  assert.deepEqual(res.body, { success: true, token: 'test-token', expiresAt: 123 });
  assert.equal(ctx.db.tables.practice_records.length, 0);
  assert.equal((await ctx.login()).body.attemptsLeft, 4);
});

test('the window expires 15 minutes after the last failed attempt', async t => {
  const now = new Date('2026-09-30T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const ctx = setup();
  for (let i = 0; i < 5; i++) await ctx.login();
  t.mock.timers.tick(15 * 60 * 1000);
  assert.equal((await ctx.login()).statusCode, 429);
  t.mock.timers.tick(1);
  assert.equal((await ctx.login()).body.attemptsLeft, 4);
  assert.equal(ctx.db.tables.practice_records[0].value.failures, 1);
});

test('hash key uses real IP first, then the first forwarded IP, then unknown', async () => {
  const ctx = setup();
  const headers = [
    { 'x-real-ip': '192.0.2.2', 'x-forwarded-for': '192.0.2.3, 192.0.2.4' },
    { 'x-forwarded-for': '192.0.2.3, 192.0.2.4' }, {}
  ];
  for (const value of headers) await ctx.login('wrong', value);
  assert.deepEqual(ctx.db.tables.practice_records.map(row => row.key), ['192.0.2.2', '192.0.2.3', 'unknown'].map(ip =>
    `counter:login:${createHash('sha256').update(`${ip}:${process.env.ADMIN_SALT}`).digest('hex')}`));
});

test('missing table and returned/thrown database errors fail open and log codes only', async t => {
  const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const throwError of [false, true]) {
    const db = fakeDb(); db.error = { code: '42P01', message: 'private database details' }; db.throwError = throwError;
    const ctx = setup(db);
    assert.equal((await ctx.login()).statusCode, 401);
    assert.equal((await ctx.login('correct')).statusCode, 200);
    assert.equal(ctx.verified, 2);
  }
  for (const log of logs) assert.deepEqual(log, ['admin-login', { code: '42P01' }]);
});

test('write and delete failures still return the password verification result', async t => {
  t.mock.method(console, 'error', () => {});
  const db = fakeDb(); db.error = query => query.action === 'select' ? null : { code: 'unavailable' };
  const ctx = setup(db);
  assert.equal((await ctx.login()).statusCode, 401);
  assert.equal((await ctx.login('correct')).statusCode, 200);
});
