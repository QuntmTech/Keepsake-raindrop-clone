from pathlib import Path
import json


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


pb_path = Path('lib/backend/pocketbase.ts')
pb = pb_path.read_text()
pb = replace_once(
    pb,
    """        hosted_ai: Boolean(r.hosted_ai),
        ai_credit_allowance: r.ai_credit_allowance ?? null,
        capture_tier: String(r.capture_tier ?? 'basic'),
""",
    """        hosted_ai: Boolean(r.hosted_ai),
        ai_credit_allowance: r.ai_credit_allowance ?? null,
        ai_credit_period:
          r.ai_credit_period === 'day' || r.ai_credit_period === 'month' || r.ai_credit_period === 'unlimited'
            ? r.ai_credit_period
            : undefined,
        capture_tier: String(r.capture_tier ?? 'basic'),
""",
    'PocketBase plan credit period',
)
pb = replace_once(
    pb,
    "async createCheckoutSession(plan: 'pro', interval: 'month' | 'year'): Promise<{ url: string }> {",
    "async createCheckoutSession(plan: 'pro' | 'max', interval: 'month' | 'year'): Promise<{ url: string }> {",
    'PocketBase checkout plan contract',
)
pb = replace_once(
    pb,
    "const plan = r.plan === 'owner' || r.plan === 'pro' ? r.plan : 'free';",
    "const plan = r.plan === 'owner' || r.plan === 'pro' || r.plan === 'max' ? r.plan : 'free';",
    'PocketBase Max auth plan',
)
pb_path.write_text(pb)

types_path = Path('lib/backend/types.ts')
types = types_path.read_text()
types = replace_once(
    types,
    """  // Max checkout is added by backend issue #20; keep the existing Pro contract
  // compatible until that server route exists.
  createCheckoutSession?(plan: 'pro', interval: 'month' | 'year'): Promise<{ url: string }>;
""",
    """  // The server route owns pricing and must validate the requested paid plan.
  // The current UI launches Pro; Max is accepted here for the 8.16 backend contract.
  createCheckoutSession?(plan: 'pro' | 'max', interval: 'month' | 'year'): Promise<{ url: string }>;
""",
    'Backend checkout plan contract',
)
types_path.write_text(types)

Path('scripts/test-release-backend-contract-816.mjs').write_text(r"""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pocketbase = readFileSync(new URL('../lib/backend/pocketbase.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../lib/backend/types.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../lib/auth.ts', import.meta.url), 'utf8');

test('verified and cached auth both preserve Max accounts', () => {
  assert.match(pocketbase, /r\.plan === 'max'/);
  assert.match(auth, /parsed\.record\.plan === 'max'/);
});

test('PocketBase plan rows preserve the authoritative AI credit period', () => {
  assert.match(pocketbase, /ai_credit_period:/);
  assert.match(pocketbase, /r\.ai_credit_period === 'day'/);
  assert.match(types, /ai_credit_period\?: 'day' \| 'month' \| 'unlimited'/);
});

test('the shared checkout contract accepts both paid plans', () => {
  assert.match(types, /createCheckoutSession\?\(plan: 'pro' \| 'max'/);
  assert.match(pocketbase, /createCheckoutSession\(plan: 'pro' \| 'max'/);
});
""")

Path('.github/workflows/build-store-zip.yml').write_text("""name: Build Chrome Web Store ZIP

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Check out source
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run full release validation
        run: npm run check

      - name: Build store-safe ZIP
        run: |
          rm -f .output/*.zip
          npm run zip:store

      - name: Verify store package
        run: |
          ZIP="$(find .output -maxdepth 1 -type f -name '*.zip' | head -n 1)"
          test -n "$ZIP"
          rm -rf store-verify
          mkdir store-verify
          unzip -q "$ZIP" -d store-verify
          MANIFEST="$(find store-verify -type f -name manifest.json | head -n 1)"
          test -n "$MANIFEST"
          node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1])); if(m.manifest_version!==3) throw new Error('Not Manifest V3'); if(m.version!=='8.16.0') throw new Error('Wrong version '+m.version); if(Object.prototype.hasOwnProperty.call(m,'key')) throw new Error('Store ZIP contains forbidden development key'); console.log('Verified store-safe Keepsake',m.version);" "$MANIFEST"
          cp "$ZIP" Keepsake-8.16.0-Chrome-Web-Store.zip

      - name: Upload Chrome Web Store ZIP
        uses: actions/upload-artifact@v4
        with:
          name: Keepsake-8.16.0-Chrome-Web-Store
          path: Keepsake-8.16.0-Chrome-Web-Store.zip
          if-no-files-found: error
          retention-days: 30
""")

Path('docs/RELEASE_HANDOFF_8.16.md').write_text("""# Keepsake 8.16 release handoff

## Canonical source

- Repository: `QuntmTech/Keepsake-raindrop-clone`
- Release branch: `main`
- Extension / manifest version: `8.16.0`
- Hosted PocketBase URL baked into published builds: `https://keepsake-chrome-extension.cloudpod.pro`

## Responsibility map

### Extension/code AI
Owns the WXT/React extension, Manifest V3 package, popup, side panel, new-tab Home, dashboard, Capture Studio, Quick Bar, local storage, PocketBase client contract, tests, build pipeline, and Web Store ZIP.

### Website/frontend AI
Owns the public website, pricing pages, account/dashboard web pages, support pages, privacy policy, terms, deletion instructions, Chrome Web Store listing copy, screenshots, promotional images, and consistency between marketing claims and what is actually live.

### PocketBase/backend AI
Owns the live PocketBase deployment, schema/migrations, API rules, auth/email delivery, backups, rate limits, custom API routes, Stripe secrets/webhooks, plans and entitlements, hosted-AI proxy, credit ledger, server-side enforcement, observability, and production smoke tests.

## Confirmed extension state

- Manifest V3 release metadata is `8.16.0`.
- Home uses a light server query that fetches only pinned/Home rows and excludes cached full-page content.
- Cold start now code-splits the Add Apps catalog, click-only dialogs, AI tour, widgets, and watching strip away from the initial new-tab bundle.
- Cached auth, Home tiles, folders, and counts paint first; server refreshes and widget machinery run afterward.
- AI selection command center supports built-in and custom actions, site/subdomain blocking, visit dismissal, and global disable.
- Desktop Home widgets are draggable and resizable.
- Store builds use `npm run zip:store`; the normal development package contains a fixed manifest key and must not be uploaded.

## Backend contract that must be verified live

1. `users.plan` accepts `free`, `pro`, `max`, and `owner`.
2. `plans` contains `free`, `pro`, and `max` rows with bookmark/watch/storage limits, hosted AI, `ai_credit_allowance`, `ai_credit_period`, capture tier, and Stripe price ids.
3. Checkout route: `POST /api/keepsake/create-checkout-session`.
4. Portal route: `POST /api/keepsake/create-portal-session`.
5. Stripe webhook route: `POST /api/keepsake/stripe-webhook`.
6. Checkout must validate the requested plan and interval server-side; Stripe webhooks are the source of truth for account plan changes.
7. Bookmark API rules must isolate every row to its authenticated owner.
8. Bookmark fields used by the extension include `content`, `pinned`, `homeOnly`, `sort`, and `broken` in addition to the core fields.
9. Batch import, quota rejection, Retry-After behavior, password reset email, auth refresh, backups, and restore must be tested against the live server.

## Hosted AI warning

Backend issue #20 is still the authoritative handoff for Free/Pro/Max hosted-AI credits. The extension's working AI path is currently BYOK: the user enables AI and supplies a Novita, OpenAI, Anthropic, or Google key stored locally. Do not market no-key hosted AI as live until the backend proxy, atomic credit deduction, usage ledger, resets, rate limits, and structured limit errors are deployed and tested.

## PocketBase documentation warning

`pocketbase/pb_schema.json` and `pocketbase/schema.md` describe the core vault collections but are not a complete production backend for billing, plans, webhooks, hosted AI, usage ledgers, or every newer bookmark field. The backend AI must treat the live migrations/schema as authoritative and update these files after production is verified.

## Submission checklist

- Download the artifact named `Keepsake-8.16.0-Chrome-Web-Store`.
- Load the unpacked production build once in a clean Chrome profile and smoke-test signup/login, Home, save, search, capture, dashboard, import/export, AI setup, logout/login, and offline recovery.
- Publish an accurate privacy policy and account/data deletion instructions.
- Complete Chrome Web Store privacy disclosures and permission justifications for every requested permission and host permission.
- Use a clear differentiated title such as `Keepsake — AI Bookmark Manager`, because other Web Store products already use the word Keepsake.
- Do not advertise hosted AI, Max checkout, or any backend behavior that has not been proven live.
""")

package_path = Path('package.json')
package = json.loads(package_path.read_text())
package['scripts']['test:release-backend-816'] = 'node --test scripts/test-release-backend-contract-816.mjs'
if 'npm run test:release-backend-816' not in package['scripts']['test']:
    package['scripts']['test'] += ' && npm run test:release-backend-816'
package_path.write_text(json.dumps(package, indent=2) + '\n')

print('Keepsake 8.16 release finalization materialized.')
