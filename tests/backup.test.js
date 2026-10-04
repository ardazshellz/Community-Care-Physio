import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../lib/backup-crypto.js';

test('backup round-trips through AES-256-GCM and rejects the wrong secret', () => {
  const json = JSON.stringify({ tables: { practice_records: [{ key: 'outcome:1', value: { numeric: 14 } }] } });
  const file = encrypt(json, 'correct horse battery staple');
  assert.equal(file.subarray(0, 4).toString(), 'CCP1');
  assert.equal(decrypt(file, 'correct horse battery staple'), json);
  assert.throws(() => decrypt(file, 'wrong secret'), /Unsupported state|unable to authenticate/);
});
