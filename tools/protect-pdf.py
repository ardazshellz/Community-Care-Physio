#!/usr/bin/env python3
"""Password-protect a report PDF before emailing it to a referrer.

    python3 tools/protect-pdf.py "Report.pdf" "the-referrer-password"

Writes "Report (protected).pdf" next to the original. One password per
referrer, agreed at acceptance and sent by text or WhatsApp, never by email.
Uses pypdf (already installed on this Mac): AES-256, no owner password.
"""
import sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter

if len(sys.argv) != 3:
    sys.exit(__doc__)
src, password = Path(sys.argv[1]), sys.argv[2]
if len(password) < 8:
    sys.exit('Use a password of at least 8 characters.')
writer = PdfWriter(clone_from=PdfReader(src))
writer.encrypt(user_password=password, algorithm='AES-256')
out = src.with_name(f'{src.stem} (protected).pdf')
with open(out, 'wb') as f:
    writer.write(f)
print('wrote', out)
