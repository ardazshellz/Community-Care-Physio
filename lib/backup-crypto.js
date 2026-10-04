// AES-256-GCM file format for nightly backups (api/backup.js, tools/decrypt-backup.mjs).
// Layout: magic 'CCP1' (4) | iv (12) | auth tag (16) | ciphertext.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const keyFor = (secret) => createHash('sha256').update(secret).digest();

export function encrypt(json, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const body = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('CCP1'), iv, cipher.getAuthTag(), body]);
}

export function decrypt(buf, secret) {
  if (buf.subarray(0, 4).toString() !== 'CCP1') throw new Error('Not a CCP backup file.');
  const d = createDecipheriv('aes-256-gcm', keyFor(secret), buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]).toString('utf8');
}
