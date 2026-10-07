// Prints the referral pack, the terms of engagement and the home care agency one-pager to assets/*.pdf with the
// installed Google Chrome. Run after editing fees or wording:
//   node tools/referral-pack/build.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const jobs = [['index.html', 'referral-pack.pdf'], ['terms.html', 'terms-of-engagement.pdf'], ['agency.html', 'home-care-agencies.pdf']];

for (const [html, pdf] of jobs) {
  const src = path.join(here, html);
  const out = path.resolve(here, '../../assets', pdf);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
    '--virtual-time-budget=4000', // let web fonts load before printing
    `--print-to-pdf=${out}`, `file://${src}`
  ], { stdio: 'inherit' });
  console.log('wrote', out);
}
