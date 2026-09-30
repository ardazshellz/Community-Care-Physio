#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

clasp() {
  npx --yes @google/clasp@2 "$@"
}

if [[ ! -f "$HOME/.clasprc.json" ]]; then
  echo 'Sign in first: npx --yes @google/clasp@2 login' >&2
  exit 1
fi

if [[ ! -f .clasp.json ]]; then
  # clasp create may replace the manifest with its defaults.
  manifest_backup="$(mktemp)"
  cp appsscript.json "$manifest_backup"
  trap 'cp "$manifest_backup" appsscript.json; rm -f "$manifest_backup"' EXIT
  clasp create --type webapp --title "CC Physio notes" --rootDir .
  cp "$manifest_backup" appsscript.json
  rm -f "$manifest_backup"
  trap - EXIT
fi

clasp push -f
deploy_output="$(clasp deploy --description "CC Physio notes")"
printf '%s\n' "$deploy_output"

# Match the deployment just created, rather than an older deployment or @HEAD.
created_id="$(printf '%s\n' "$deploy_output" | sed -nE 's/^[[:space:]]*- ([A-Za-z0-9_-]+) @[0-9]+.*$/\1/p' | tail -n 1)"
deployments="$(clasp deployments)"
deployment_id="$(printf '%s\n' "$deployments" | awk -v id="$created_id" '$1 == "-" && $2 == id && $3 ~ /^@[0-9]+/ { print $2; exit }')"
if [[ -z "$deployment_id" ]]; then
  printf '%s\n' "$deployments"
  echo 'Could not identify the new deployment. Open the project with npx --yes @google/clasp@2 open and copy its Web app URL from Deploy > Manage deployments.' >&2
  exit 1
fi

printf '\nWeb app URL: https://script.google.com/macros/s/%s/exec\n\n' "$deployment_id"
printf 'From this folder (%s), open the project:\n' "$PWD"
echo '  npx --yes @google/clasp@2 open'
echo 'In the editor, select createSecret and click Run once. Approve Google permissions when prompted.'
echo 'Copy the secret from the execution log and the URL above into admin > Referrals & invoices > Settings > Google Drive notes, then click Save Drive settings.'
