# Roadmap and open items

Proposed order for the company side. Later steps depend on earlier ones. Do not file, pay, or buy anything without Jerry’s explicit confirmation.

## Proposed order

1. **Form 18nover LLC in Kentucky**, then get the EIN. See [LLC research](llc.md).
2. **Stand up business email** at `18nover.gay` (Google mail records already exist), then replace the `hello@18nover.gay` placeholder if the real address is different. See [Business email](business-email.md).
3. **Open a business bank account**, then **apply to an adult-friendly payment processor**. Both need the LLC and EIN first.
4. **Write company-level legal pages** for `18nover.gay` and have them reviewed. See [Company legal pages](legal.md).

## Open items on the live site and DNS

- Set the **www → apex 308 redirect** in the Vercel UI. `www.18nover.gay` still returns 200. See [Vercel project and deploys](vercel.md).
- Retire leftover alias **`18nover-site-18nover.vercel.app`**. `18nover-site.vercel.app` is already gone. Removal could not be completed from the Vercel MCP connector (no delete-alias tool) or from an unauthenticated CLI. See the Vercel page.
- Remove **one** of the two duplicate Google DKIM TXT records at `google._domainkey.18nover.gay`. See [Domain and DNS](dns.md).
- After a real inbox exists, add an optional **DMARC** record starting at `p=none`.
- Keep `CONTACT_EMAIL` marked as a placeholder until the mailbox is proven to receive mail.

## Planned Cloudflare move

**Status: plan only. The migration has not started.** Do not change live infrastructure, DNS, or this repository for a Cloudflare cutover until Jerry approves the plan and cutover work begins.

Jerry asked to leave Vercel before the site takes payments, and to start on the free or cheapest path. Supervisor holds the full shared plan (OnlyMen and 18nover together). This section is the 18nover slice only.

**Preferred path for this company site:** enable Next.js static export (`output: "export"` in `next.config.ts`, if it builds cleanly) and deploy as **Cloudflare Workers Static Assets**. Static asset requests are free and unlimited on Workers and would not consume the account’s daily Worker request quota. Keep the `mailto:` contact form as-is; no backend is required.

**Fallback:** if static export is blocked by a Next.js feature, use [vinext](https://github.com/cloudflare/vinext) (Cloudflare’s current Next.js-on-Workers path) and deploy a Worker. That can still start at $0.

When work is approved, it should happen on a branch in `18nover/18nover`, deploy first to a `*.workers.dev` preview, and only then consider DNS. Porkbun should stay the registrar. A production Custom Domain on Workers needs the zone on Cloudflare, which means a later nameserver move — email MX, SPF, DKIM, and verification records have to be copied first. Vercel should keep serving `18nover.gay` until Cloudflare HTTPS is verified on the real domain. Rollback is switching nameservers back.

The 18nover bot must not start this migration on its own. Supervisor coordinates the shared Cloudflare account and any nameserver cutover. OnlyMen’s move is a separate, heavier piece of work owned by the onlymen bot.
