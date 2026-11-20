# Cloudflare Workers deployment (replaces Render)

The Node server (`server/index.js`) remains available for local development. The Cloudflare Worker now serves
the static site and implements the same account/RFI routes using D1, so account actions and pages can share one
Cloudflare origin. Small supported attachments are stored privately as D1 rows and only streamed through an
authorized Worker request.

- `worker/budgets.js` / `worker/limits.js`: the former in-memory limits (15 attempts/hour/IP, 20 batches/hour,
  one active batch, public demo allowance, Jev per-IP limits), now persisted in one Durable Object so every
  Worker isolate shares them. A batch slot self-releases after 12 minutes if an invocation is killed.
- `scripts/build-worker.js`: copies the public files to `dist/` and embeds the rubric and implementation
  sources in `worker/sources.js` so `implementation_hash` is computed from the same bytes as under Node.
- `worker/workspace.js`: D1-backed account sessions and role-scoped RFI API.
- `migrations/0001_workspace.sql`: D1 schema for users, sessions, RFIs, threaded messages and attachments.
- `scripts/migrate-workspace-to-d1.mjs`: one-time import of `server-data/rfi-workspace.json`; preserves password
  hashes, RFI IDs, conversation history and attachment contents. It does not import active sessions.

## Initial Cloudflare setup

1. From the repository root, install the declared Wrangler dependency and sign in:

   ```sh
   npm install
   npx wrangler login
   ```

2. Create the D1 database and replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID:

   ```sh
   npx wrangler d1 create info492-workspace
   ```

3. Apply the schema to Cloudflare:

   ```sh
   npx wrangler d1 migrations apply info492-workspace --remote
   ```

4. If you want to preserve accounts made on the local Node site, run the migration script **before the first
   account is created in D1**. Create a Cloudflare API token scoped to this account with D1 edit permission. In
   Terminal, enter the token without echoing it, then run:

   ```sh
   export CLOUDFLARE_ACCOUNT_ID="your-account-id"
   export CLOUDFLARE_D1_DATABASE_ID="your-d1-database-id"
   read -s CLOUDFLARE_API_TOKEN
   export CLOUDFLARE_API_TOKEN
   node scripts/migrate-workspace-to-d1.mjs
   unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_D1_DATABASE_ID
   ```

   The script reads the ignored local JSON file and sends the records directly to D1 over HTTPS. It refuses to
   combine the source with unrelated target accounts. Run it from the repository root. The source JSON is not
   published. Render-side data is separate and is not included in this local-file import.

5. Add the provider secrets used by the existing demos. Enter each value when Wrangler prompts; never put the
   values in a tracked file:

   ```sh
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put JEV_API_KEY
   ```

6. Test locally with the local D1 copy, then deploy:

   ```sh
   npx wrangler d1 migrations apply info492-workspace --local
   npm run dev:worker
   npm run deploy:worker
   ```

   `npm run deploy:worker` runs the tests, static validation, asset preparation and Wrangler deployment. Use the
   Worker URL printed by Wrangler (or configure a custom domain in Cloudflare). The Worker-first `/api/*` routing
   and static asset binding are already configured in `wrangler.jsonc`.

7. After the first deployment, set `backend_origin` in `data/workspace-config.json` to the Worker origin, for
   example `https://info492.<your-workers-subdomain>.workers.dev`, then run `npm run deploy:worker` again so the
   published static files contain the correct API origin. Keep GitHub Pages on its current Render setting until
   the Cloudflare site and API pass the smoke checks; then direct users to the Worker URL and retire the old
   endpoint when you are satisfied.

8. Verify the deployed Worker before switching users:

   ```sh
   node scripts/smoke-test.mjs https://<your-worker-origin>
   ```

   Also open `/signin.html`, create sender and responder test accounts, send an RFI with a PDF or image, reply
   from the responder Demo 3 board, and check that the sender sees the thread after signing back in. An unauthenticated
   `GET /api/workspace/me` should return JSON `401`; `GET /signin.html` should return the page.

The local account store and D1 are separate until you run the migration. The import creates fresh sessions only
when users sign in again. If Render has account/RFI data that is not in the local JSON file, export and migrate it
separately before retiring Render.

Free-plan limits: 100,000 requests/day, 10 ms CPU per request (network waits do not count),
50 outbound subrequests per request. If the dashboard shows "Exceeded CPU Time Limits" (Error 1102),
the options are the paid plan or reducing per-request work.

Known deliberate differences: `signin.html` is now served (Render's allowlist omitted it), the public-allowance
`counter_scope` label reads `single_durable_object_persisted`, and a client disconnect may cancel batch items
not yet started (Workers allow ~30 s of background work after a client leaves).

Smoke test: `node scripts/smoke-test.mjs https://<worker-url> [--batch]`
