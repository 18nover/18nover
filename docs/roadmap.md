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

**Status: Phase 1 (preview) is in this repo. DNS cutover has not started.** Production `18nover.gay` still points at Vercel. Do not change Porkbun records, add Custom Domains, or touch the Vercel project until Jerry and Supervisor approve the later phases.

Jerry asked to leave Vercel before the site takes payments, and to start on the free or cheapest path. Supervisor holds the full shared plan (OnlyMen and 18nover together). This section is the 18nover slice only.

**Path taken:** Next.js static export (`output: "export"`) served as **Workers Static Assets**. The export builds cleanly, so vinext is not used. The `mailto:` contact form is unchanged. Details, deploy commands, and pending cutover steps are in [Cloudflare preview](cloudflare.md).

The preview hostname is `https://18nover.18nover.workers.dev` (Worker name `18nover`, account workers.dev subdomain `18nover`). Publishing that Worker requires Wrangler auth on the 18nover Cloudflare account.

Porkbun stays the registrar. A production Custom Domain needs the zone on Cloudflare, which means a later nameserver move — email MX, SPF, DKIM, and verification records have to be copied first. Vercel should keep serving `18nover.gay` until Cloudflare HTTPS is verified on the real domain. Rollback is switching nameservers back.

Supervisor coordinates the shared Cloudflare account and any nameserver cutover. OnlyMen’s move is a separate, heavier piece of work owned by the onlymen bot.
