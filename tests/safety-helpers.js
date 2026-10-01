import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { durationMins, occupiedSlots, overlaps } from '../lib/slots.js';

export function response() {
  return {
    statusCode: 200, setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, end() { return this; }
  };
}

export function fakeDb(initial = {}) {
  const tables = structuredClone(initial);
  const calls = [];
  const db = { tables, calls, error: null, throwError: false, from(table) {
    const query = { table, action: 'select', filters: [], values: null, options: null };
    let single = false;
    const chain = {
      select(columns) { query.columns = columns; return chain; },
      eq(key, value) { query.filters.push(row => row[key] === value); return chain; },
      neq(key, value) { query.filters.push(row => row[key] != null && row[key] !== value); return chain; },
      or(expr) { // supports 'key.is.null,key.neq.value'
        const parts = expr.split(',').map(p => p.split('.'));
        query.filters.push(row => parts.some(([key, op, value]) => op === 'is' ? row[key] == null : op === 'neq' ? row[key] !== value : row[key] === value));
        return chain;
      },
      gt(key, value) { query.filters.push(row => row[key] > value); return chain; },
      gte(key, value) { query.filters.push(row => row[key] >= value); return chain; },
      in(key, values) { query.filters.push(row => values.includes(row[key])); return chain; },
      not(key, op, value) { assert.equal(op, 'is'); query.filters.push(row => row[key] !== value); return chain; },
      single() { single = true; return chain; }, maybeSingle() { single = true; return chain; },
      insert(values) { query.action = 'insert'; query.values = values; return chain; },
      upsert(values, options) { query.action = 'upsert'; query.values = values; query.options = options; return chain; },
      update(values) { query.action = 'update'; query.values = values; return chain; },
      delete() { query.action = 'delete'; return chain; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          calls.push(query);
          const error = typeof db.error === 'function' ? db.error(query) : db.error;
          if (error) {
            if (db.throwError) throw error;
            return { data: null, error };
          }
          const rows = tables[table] ||= [];
          let data = rows.filter(row => query.filters.every(filter => filter(row)));
          if (query.action === 'update') data.forEach(row => Object.assign(row, structuredClone(query.values)));
          if (query.action === 'delete') tables[table] = rows.filter(row => !data.includes(row));
          if (['insert', 'upsert'].includes(query.action)) {
            data = [];
            for (const value of Array.isArray(query.values) ? query.values : [query.values]) {
              const keys = (query.options?.onConflict || 'id').split(',');
              const existing = rows.find(row => keys.every(key => value[key] !== undefined && row[key] === value[key]));
              if (existing) {
                if (!query.options?.ignoreDuplicates) Object.assign(existing, structuredClone(value));
                data.push(existing);
              } else {
                const row = { id: `test-${rows.length + 1}`, ...structuredClone(value) };
                rows.push(row); data.push(row);
              }
            }
          }
          return { data: structuredClone(single ? data[0] || null : data), error: null };
        }).then(resolve, reject);
      }
    };
    return chain;
  } };
  return db;
}

// Evaluate the real handler with service imports replaced by local fakes only.
// No installed SDK, credentials, network, or outgoing mail is needed.
export function loadHandler(name, { db, stripe = {}, mail = [], logs = [], Date: clock = Date } = {}) {
  assert.ok(['create-checkout', 'get-slots', 'stripe-webhook'].includes(name));
  let source = readFileSync(new URL(`../api/${name}.js`, import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '')
    .replace('export const config', 'const config')
    .replace('export default async function handler', 'async function handler')
    .replace("await import('nodemailer')", '({ default: fakeNodemailer })');
  const context = vm.createContext({
    supabase: db, Stripe: function () { return stripe; },
    fakeNodemailer: { createTransport() { return { async sendMail(message) { mail.push(message); } }; } },
    durationMins, occupiedSlots, overlaps, Date: clock, Buffer,
    process: { env: {} }, console: { log() {}, error(...args) { logs.push(args); } },
    checkoutQuote() { return { priceInPence: 10000, treatment: 10000, complexityFee: 0, travel: { total: 0 } }; },
    bookingFlags() { return []; }, TRIAGE_FLAGS: {}
  });
  return vm.runInContext(source + '\nhandler;', context);
}
