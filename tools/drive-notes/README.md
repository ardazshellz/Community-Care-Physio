# Google Drive session notes — one-time setup (about 5 minutes)

The 📝 Notes button on each patient and session in the admin page creates (or reopens) a Google Doc:

`My Drive › CC Physio – Patient notes › <Patient> — <Programme> › <Wed 30 Sep 2026, 2.00pm — Follow-up 1>`

Each new note starts with a SOAP template. Notes stay in your own Google Drive; the website never stores them.

## Quick setup (recommended)

You need Node.js and npm. In a terminal, change to `tools/drive-notes`, then:

1. Sign in to the Google account that will hold your notes:
   ```sh
   npx --yes @google/clasp@2 login
   ```
2. Create and deploy the script:
   ```sh
   ./setup.sh
   ```
3. Open the editor:
   ```sh
   npx --yes @google/clasp@2 open
   ```
   Select **createSecret** and click **Run** once. Approve Google's permissions when prompted. Copy the secret from the execution log and the URL printed by setup into **admin › Referrals & invoices › Settings › Google Drive notes**, then click **Save Drive settings**.

If Google asks you to enable the Apps Script API, enable it at <https://script.google.com/home/usersettings> and run setup again. Google may show an unverified app warning for your own script: **Advanced › Go to CC Physio notes**.

The setup script works from any directory when called by its path. It keeps the account-specific project ID in an ignored `.clasp.json`. Running setup again creates a new deployment URL; save that URL in admin Settings. Running `createSecret` again shows the existing secret.

## Manual setup (fallback)

1. Sign in to the Google account that holds your notes (e.g. infoccphysio@gmail.com) and open <https://script.google.com> › **New project**. Name it `CC Physio notes`.
2. Delete the sample code and paste the contents of `Code.gs` from this folder. Save.
3. **Project Settings** (cog) › **Script properties** › **Add script property**: name `SECRET`, value = a long random string. In the admin page go to **Referrals & invoices › Settings › Google Drive notes**, click **Generate secret**, copy it here.
4. **Deploy › New deployment** › type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (the shared secret protects it; this avoids problems when several Google accounts are signed in).
5. Click **Deploy**, authorise access to Drive and Docs (Google shows an "unverified app" warning because it is your own script: **Advanced › Go to CC Physio notes**).
6. Copy the **Web app URL** (ends in `/exec`) into the admin Settings field and click **Save Drive settings**.
7. Test: open a patient, click 📝 Notes.

If you change `Code.gs` later, use **Deploy › Manage deployments › Edit › New version** so the URL stays the same.
