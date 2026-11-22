# 18nover company documentation

Internal operations notes for the **18nover** company website at [18nover.gay](https://18nover.gay). This is the parent company behind [OnlyMen](https://onlymen.gay).

This folder describes what is live today, what is still open, and which bot owns which work. It is not legal, tax, or financial advice.

**Last verified:** Saturday, Nov 21, 2026, about 9:28 PM America/New_York.

## Contents

| Page | What it covers |
|---|---|
| [Stack and architecture](stack.md) | Next.js 15 App Router site, mailto contact form, no database |
| [Vercel project and deploys](vercel.md) | Team, project rename, git push-to-deploy, leftover aliases, www redirect |
| [Domain and DNS](dns.md) | 18nover.gay at Porkbun, current records, duplicate DKIM, DMARC |
| [Branding](branding.md) | Colors, type, crest assets, shared OnlyMen tokens |
| [Business email](business-email.md) | Google mail records already exist; `hello@18nover.gay` is still a placeholder |
| [LLC research](llc.md) | Kentucky LLC research status (not filed) |
| [Company legal pages](legal.md) | Current footer links vs. company-level pages still to write |
| [Bot ownership](ownership.md) | Who owns the company site vs. OnlyMen vs. shared infra |
| [Roadmap](roadmap.md) | Open items, proposed order, and the planned Cloudflare move |

## Snapshot

- Live site: https://18nover.gay (HTTPS on Vercel). `www.18nover.gay` also returns 200; the 308 to the apex is still pending in the Vercel UI.
- Repo: [`18nover/18nover`](https://github.com/18nover/18nover), default branch `main`.
- Vercel: team **18nover**, project **18nover** (renamed from `18nover-site`), git push-to-deploy from this repo.
- Registrar and DNS: Porkbun. Apex A records and `www` CNAME point at Vercel. Existing Google Workspace MX, SPF, DKIM, and site-verification records were left in place.
- The site is a static marketing page plus a `mailto:` form. There is no database, no auth, and no server API.
- `CONTACT_EMAIL` in `lib/config.ts` is still the placeholder `hello@18nover.gay`. That mailbox does not exist yet.
- 18nover LLC has been researched for Kentucky and has **not** been filed.
- A move off Vercel to Cloudflare is planned and has **not** started. See [Roadmap](roadmap.md#planned-cloudflare-move).

Do not put API keys, tokens, passwords, or other secrets in these docs.
