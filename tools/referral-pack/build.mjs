// Prints tools/referral-pack/index.html to assets/referral-pack.pdf with the
// installed Google Chrome. Run after editing fees or wording:
//   node tools/referral-pack/build.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'index.html');
const out = path.resolve(here, '../../assets/referral-pack.pdf');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
  '--virtual-time-budget=4000', // let web fonts load before printing
  `--print-to-pdf=${out}`, `file://${src}`
], { stdio: 'inherit' });
console.log('wrote', out);
