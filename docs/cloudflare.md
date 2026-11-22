# Cloudflare preview (Workers Static Assets)

**Status:** The company site now builds as a Next.js static export and is configured for an **assets-only Worker** named `18nover`. Production DNS and the Vercel project are unchanged. `18nover.gay` still points at Vercel.

Jerry approved moving hosting to Cloudflare. This repo change is Phase 1 of the shared plan: code on a branch, preview only on `workers.dev`. Nameserver cutover, custom domains, and retiring Vercel are still pending and must not be started from this branch.

## Approach

Static export worked, so vinext is **not** used.

- `next.config.ts` sets `output: "export"` (and `images.unoptimized` so a future `next/image` would not break the export).
- `next build` writes static files to `out/` (`out/` is gitignored).
- `wrangler.jsonc` serves `./out` as Workers Static Assets, with `not_found_handling: "404-page"` so Next’s `out/404.html` is used for unknown paths.
- There is no Worker script (`main` is omitted). There are no routes and no custom domains in the config. `workers_dev` is `true`.
- The contact form is still a client-side `mailto:` link. No backend was added.

The Cloudflare account’s `workers.dev` subdomain is **18nover**, so the preview hostname is:

`https://18nover.18nover.workers.dev`

That subdomain was created so a preview can be published. Publishing the Worker itself requires Wrangler to be authenticated to the **18nover** Cloudflare account (`npx wrangler deploy` after `wrangler login`, or `CLOUDFLARE_API_TOKEN` with Workers Scripts Write). Do not use `wrangler deploy --temporary`; that would land on a throwaway account, not `18nover`.

## Local development and deploy

```bash
npm install
npm run dev          # Next.js dev server (unchanged)
npm run build        # static export to out/
npm run preview      # wrangler dev, after a build
npm run deploy       # build + wrangler deploy to workers.dev
```

`npm start` now runs `wrangler dev` as well, because `next start` is not supported with `output: "export"`.

Do **not** add `routes` or Custom Domains to `wrangler.jsonc` until Supervisor runs the DNS cutover. Leave the Vercel project running.

## Cutover steps still pending

These are from the shared plan. They are **not** part of this branch and must not be done until preview QA is accepted and Jerry / Supervisor approve the later phases.

1. Supervisor takes a fresh Porkbun DNS export for `18nover.gay` (and the OnlyMen domains) and diffs it against the existing backup.
2. Add the domains as **free** Cloudflare zones **without** changing nameservers yet. Copy every record. Mail records (MX, SPF, DKIM, Google verification) must stay DNS-only (grey cloud).
3. Jerry and Supervisor compare Cloudflare vs Porkbun side by side.
4. After that review, Jerry approves the nameserver move at Porkbun (Porkbun stays the registrar). Rollback is switching NS back to the Porkbun nameservers; leave the current Vercel A/CNAME records in place on Porkbun during the wait.
5. Once the zone is Active, attach a Workers Custom Domain `18nover.gay` → Worker `18nover`, let Cloudflare issue the certificate, and add the official `www` → apex redirect.
6. Confirm HTTPS on the real hostname, the www redirect, the landing page, OnlyMen links, the mailto form, and that Google mail still works.
7. Watch Cloudflare for 24–48 hours, then add CI (GitHub Actions or Workers Builds). Only then turn off Vercel production deploys. Do not delete the Vercel project immediately.

OnlyMen’s Worker is a separate workstream owned by the onlymen bot. Shared account and nameserver work goes through Supervisor.
