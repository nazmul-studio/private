# private
Single-owner private vault on Cloudflare (Workers + R2 + D1 + Durable Objects).
## Deploy
1. `npm install` then `npx wrangler login`
2. `npx wrangler d1 create private` -> paste the printed `database_id` into `wrangler.jsonc`
3. `npx wrangler d1 migrations apply private --remote`
4. Make sure R2 bucket `private` exists (binding `MEDIA_BUCKET`; the Worker needs no R2 keys)
5. `npx wrangler secret put SETUP_TOKEN` (any long random string; keep it, it is also the lockdown reset key)
6. `npm run deploy`, open `/setup.html` once to create the owner, then sign in at `/`
## Local
Copy `.dev.vars.example` to `.dev.vars` with `SETUP_TOKEN=...`; run `npx wrangler d1 migrations apply private --local` then `npm run dev`.
## Limits (edit in wrangler.jsonc vars)
Per-file limits are constants in `public/assets/limits.js` (images/PDF 50 MB, buffered in Worker memory; videos 350 MB, direct multipart). `TOTAL_CAP_BYTES` (8 GB) is a var in `wrangler.jsonc`. Keep the cap under R2's current free allowance; verify it on Cloudflare's pricing page.
## Emergency lockdown reset
`curl -X POST https://<worker>/api/admin/reset-lockdown -H "Origin: https://<worker>" -H "x-setup-token: <token>"`
## Large video uploads (direct to R2, multipart)
Videos (MP4/MOV, up to 350 MB) never pass through the Worker: the browser PUTs 16 MiB parts to 10-minute presigned URLs. Images/PDFs (up to 50 MB) still go through the Worker.
1. Create an R2 API token limited to Object Read & Write on bucket `private` only. Set it as secrets (never paste them into chat or commit them):
   `npx wrangler secret put R2_ACCESS_KEY_ID` and `npx wrangler secret put R2_SECRET_ACCESS_KEY`
2. Put your Cloudflare account ID in `R2_ACCOUNT_ID` (wrangler.jsonc `vars`).
3. Edit `cors.json` (your exact Worker origin) then `npx wrangler r2 bucket cors set private --file cors.json`
4. `npx wrangler d1 migrations apply private --remote`, then `npm install` and `npm run deploy` (the hourly cron aborts abandoned uploads).
5. Also add a bucket lifecycle rule to abort incomplete multipart uploads after 1 day as a second safety net (dashboard: R2 > private > Settings).
Run unit tests with `npm test` (covers upload limits, part planning, name cleaning, and the lockout/rate-limit/OTP/recovery rules).
## Sign-in, email and recovery setup
1. Turnstile: Cloudflare dashboard > Turnstile > add a widget for your workers.dev hostname. Put the Site Key in `TURNSTILE_SITE_KEY` (wrangler.jsonc); set the secret with `npx wrangler secret put TURNSTILE_SECRET`. Without the secret, sign-in and recovery refuse to work (fail closed).
2. Brevo: create an API key and run `npx wrangler secret put BREVO_API_KEY`. Verify your sender address in Brevo.
   Email addresses are NOT stored in the repo. Add them as **Secrets** in Cloudflare (Worker > Settings > Variables and Secrets, type "Secret") or with `npx wrangler secret put <NAME>`:
   - `SENDER_EMAIL` (required): the Brevo-verified sender address (`SENDER_NAME` stays in wrangler.jsonc).
   - `LOGIN_EMAIL`: receives sign-in codes.
   - `SECURITY_EMAIL`: receives lock, lockdown, passkey and recovery notices.
   Set at least one of `LOGIN_EMAIL` / `SECURITY_EMAIL`; if only one is set it is used for both. Both go through the same mail function, so they can be different addresses.
   `keep_vars` is on in wrangler.jsonc so Git deploys do not wipe variables you set in the dashboard. Secrets are never overwritten by a deploy.
3. `npx wrangler d1 migrations apply private --remote` (adds login_challenges and recovery_tokens).
Sign-in = password + secret code, then a 6-digit emailed code (10 min, 5 tries, single use). Recovery link (30 min, single use, newest only) also needs the secret code; it resets credentials, revokes sessions and lifts lockdown.
## Passkeys, Trash, albums, thumbnails
- `npm install` (adds @simplewebauthn/server) and `npx wrangler d1 migrations apply private --remote` (migration 0004).
- Passkeys: Settings > Add a passkey. Adding or removing a passkey asks for the secret code again (wrong attempts are logged and rate-limited). Once one exists, sign-in needs passkey + password + secret code + emailed code. Passkeys are tied to this hostname; moving to another domain invalidates them (use recovery > "Remove all passkeys"). Recovery can also change the login email.
- Trash empties automatically after 30 days (hourly cron). Thumbnails are made in the browser at upload (images only).
## Resume, video thumbnails, login email
- If an upload is interrupted (network drop or reload), the Overview page shows "Unfinished upload". Pick the same file and only the missing parts are sent. Cancel/Discard aborts it. It works while the same sign-in session lasts; abandoned uploads are cleaned up after 6 hours.
- Video thumbnails are captured in the browser (HEIC photos have none). Settings can change the login email after re-entering the secret code.

## GitHub -> Cloudflare deployment (Workers Builds)
1. Push this repo to GitHub. `.gitignore` already excludes `.dev.vars`, `.env*`, `node_modules`, `.wrangler`, `dist` and key files. Before the first push run `git status` and confirm none of them are listed.
2. Cloudflare dashboard > Workers & Pages > Create > Import a repository. Build command: `npm run typecheck && npm test` (optional). Deploy command: `npx wrangler deploy`.
3. Workers Builds does not apply D1 migrations. Run them yourself after every new migration file: `npm run migrate` (remote) or `npm run migrate:local`.
4. Secrets are never stored in Git. Set them once in the dashboard (Worker > Settings > Variables and Secrets, type "Secret") or with `npx wrangler secret put <NAME>`. Full list (also in `.dev.vars.example`): `SETUP_TOKEN`, `BREVO_API_KEY`, `SENDER_EMAIL`, `LOGIN_EMAIL`, `SECURITY_EMAIL`, `TURNSTILE_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and optionally `AUDIT_SALT` (key for hashing IPs in the login history; falls back to `SETUP_TOKEN`). Public, non-secret values (`R2_ACCOUNT_ID`, `TURNSTILE_SITE_KEY`, `SENDER_NAME`, `TOTAL_CAP_BYTES`, `R2_BUCKET`) live in `wrangler.jsonc`.
5. `npm run build` does a local `wrangler deploy --dry-run` (bundles the Worker into `dist/`, validates bindings, uploads nothing).

## Verify `cors.json` before first video upload
`cors.json` must contain the exact origin the browser uses, otherwise video part uploads are blocked by CORS.
1. Find your real Worker hostname: Cloudflare dashboard > Workers & Pages > private > Settings > Domains & Routes (or the URL printed by `npm run deploy`). It looks like `https://<worker-name>.<your-account-subdomain>.workers.dev`.
2. Open `cors.json` and check `allowed.origins` matches that value exactly: `https://` scheme, no trailing slash, no path, no wildcard. If you later add a custom domain, add it as a second origin.
3. Apply it: `npx wrangler r2 bucket cors set private --file cors.json`
4. Confirm what R2 actually has: `npx wrangler r2 bucket cors list private`
5. Sanity check: sign in, upload a small MP4. If the page says "The upload was blocked. Check the R2 CORS settings.", the origin in step 2 is wrong or step 3 was not run.
The origin must also be the same hostname you use for passkeys (they are tied to it).

## R2 S3 credentials checklist
- Token type: R2 API token with Object Read & Write, limited to bucket `private` only (not account-wide).
- Set `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` as Worker Secrets; `R2_ACCOUNT_ID` and `R2_BUCKET` are vars in `wrangler.jsonc`.
- The Worker signs URLs for `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/<key>` with region `auto`; each presigned URL lasts 10 minutes and covers one part.
- Add the bucket lifecycle rule that aborts incomplete multipart uploads after 1 day (dashboard: R2 > private > Settings).

## Node version and passkey library
`@simplewebauthn/server` v14 needs Node 22 or newer for local tooling and builds (`.node-version` and `engines` say 22). The Worker itself runs on Cloudflare's runtime. `npm test` includes a software-authenticator test that registers and signs in a passkey against the library with the same options the Worker uses. It cannot replace trying a real passkey once after deploy (Settings > Add a passkey, then sign out and in).

## Overview data and the vault UI (added)
- Run `npm run migrate` once for `migrations/0005_overview.sql` (session location columns + hourly traffic counter).
- `/api/overview` feeds the Overview page: storage, D1 latency, sessions (with Cloudflare-reported country/city/lat/lon at sign-in), failed sign-ins and sign-ins in 24 h, and per-hour request/bandwidth counters. Nothing on the page is placeholder data.
- The UI uses Tailwind, compiled to `public/assets/style.css` (the CSP forbids the CDN and inline styles). After changing classes in `public/*.html` or `public/assets/*.js`, run `npm install` and `npm run build:css`.

## Failed sign-ins (changed)
- 1–4 wrong attempts: normal (progressive 1–30 s delay between attempts stays).
- 5 wrong attempts: sign-in is NOT locked. The library is hidden for 12 h: after a correct sign-in the user sees a "System in maintenance" countdown, and every media/file API returns 503. Files stay untouched in R2. The security email is notified. A correct sign-in resets the counter but never ends the hold early; recovery or admin reset does.
- 10 wrong attempts: full lockdown (all sessions revoked, recovery required), as before.

## Archives and documents (added)
ZIP, RAR, 7Z, TAR, GZ, BZ2 and DOC, DOCX, TXT, RTF, ODT, XLSX, XLS, CSV, JSON, MD up to 50 MB. The server checks the file's bytes against its extension, stores a fixed type, and always serves these as downloads (never rendered in the browser).

## Photo search, selection, Trash (added)
- Run `npm run migrate` once for `migrations/0006_search.sql` (photo descriptions + search vectors), then deploy. `wrangler.jsonc` now has the `ai` binding (`AI`), which Workers Builds picks up on the next deploy. `wrangler dev` talks to the real Workers AI, so it needs you to be logged in.
- Search (top bar): type a name or describe what is in the picture (scene, colours, clothes, what is happening), in English or Bangla. Results are ranked best match first. Each new photo/video is described automatically right after its thumbnail is uploaded. For photos uploaded earlier open Settings > Photo search > Analyse photos (a few per request, repeats until done; "Retry failed" re-runs the ones that errored).
- How it works: the small thumbnail (max 300 KB, never the original) is sent to Workers AI (`@cf/moondream/moondream3.1-9B-A2B`) to write a description, then `@cf/baai/bge-m3` (multilingual) turns it into a vector stored in D1 (`media_vectors`). A search embeds your words the same way and compares meanings, plus plain word matching on names and descriptions. It describes what is visible; it does not identify people. `SEARCH_MIN` in `src/search.js` is the minimum similarity (raise it if unrelated photos appear, lower it if real matches are missing). With a very large library (tens of thousands of photos) move the vectors to Vectorize.
- Trash: every file tile has Add / Trash buttons; in Trash each tile shows days left and Restore / Delete forever, and the header has Restore all and Empty Trash. Select (top right of Files and Media, or the circle on a tile) lets you pick many files and move them to Trash, restore, delete forever, favorite, or add them to an album/folder (a new one can be created in the same dialog). Inside an album/folder, uploads go into it automatically. The upload dialog lists the chosen files and each can be removed before uploading.
- No Tailwind rebuild is needed for these changes: the new styles are plain CSS at the end of `tools/vault.css` (copied into `public/assets/style.css`).

## Overview: coloured traffic graph and 3D globe (added)
- **24-hour traffic**: one bar per hour, height and colour from the real request counts in D1 (`traffic_hourly`), blue (quiet) to red (busiest hour of the window). Hover a bar for requests and bandwidth. This counts requests made by signed-in sessions.
- **3D globe**: the real Earth, drawn on a plain canvas by `public/assets/globe.js` (no libraries, works with the strict CSP). Pins are the real city-level locations Cloudflare reports for each active session (`active_sessions.lat/lon`); the current device is gold, the country of each session is highlighted. Drag to rotate; it spins slowly when idle (not with "reduce motion" on). The page only draws while it is on screen.
- Country outlines are in `public/assets/world.json`, built by `node tools/build-world.mjs countries.geo.json` from [johan/world.geo.json](https://github.com/johan/world.geo.json) (public domain, derived from Natural Earth). It is a low-detail map: tiny islands are missing and borders follow the source data.
- Locations come from the connection's IP address, so VPNs and mobile networks can show a different city than the real one.
