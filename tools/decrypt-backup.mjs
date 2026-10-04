// Decrypt a nightly backup from api/backup.js.
//   BACKUP_SECRET='the same passphrase as in Vercel' node tools/decrypt-backup.mjs ccp-backup-2026-10-04.json.enc
// Writes ccp-backup-2026-10-04.json next to the input. Keep the output out of Git.
import { readFileSync, writeFileSync } from 'node:fs';
import { decrypt } from '../lib/backup-crypto.js';

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [, , file] = process.argv;
  const secret = process.env.BACKUP_SECRET;
  if (!file || !secret) { console.error('Usage: BACKUP_SECRET=... node tools/decrypt-backup.mjs <file.json.enc>'); process.exit(1); }
  const out = file.replace(/\.enc$/, '') || file + '.json';
  writeFileSync(out, decrypt(readFileSync(file), secret));
  console.log('wrote', out);
}
