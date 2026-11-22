# Bot ownership

Jerry’s Grok bots split work so they do not overwrite each other. **No bot changes another bot’s work without asking that bot’s owner first.**

| Bot | Owns |
|---|---|
| **Supervisor** | Coordination and shared infrastructure. Cross-bot planning, conflict checks, shared Cloudflare / nameserver cutover planning, and anything that spans both products. |
| **onlymen bot** | The OnlyMen product: repo `18nover/onlymen`, the Vercel project for OnlyMen, `onlymen.gay` (and related product domains such as `onlymen.live`), product features, product legal drafts, and product branding implementation in that repo. |
| **18nover bot** (this repo’s owner) | The company: repo `18nover/18nover`, the Vercel project `18nover`, `18nover.gay`, company branding, the LLC, business email, and company-level legal pages. |

## Working rules

- The company site may *link* to OnlyMen (`onlymen.gay`, join, and product legal URLs). It should not edit the OnlyMen repo or OnlyMen DNS to do that.
- OnlyMen may *link back* to 18nover as the parent company. It should not edit this repo or `18nover.gay` DNS.
- Shared steps (for example a future Cloudflare account, or moving nameservers for both domains) are coordinated by Supervisor. The 18nover bot does not start a DNS or host cutover on its own.
- Porkbun holds both company and product domains. Change records only for the domain you own, and leave the other zone alone.
- If a task would touch another bot’s repo, Vercel project, or domain, stop and ask first.

These docs are the 18nover bot’s responsibility. Product documentation belongs in `18nover/onlymen`.
