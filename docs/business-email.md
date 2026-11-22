# Business email

## Current state

Google mail DNS for `18nover.gay` is already in place at Porkbun: MX to `smtp.google.com`, SPF including `_spf.google.com`, and Google DKIM at `google._domainkey.18nover.gay` (see [Domain and DNS](dns.md) for the duplicate DKIM record).

The website still uses a **placeholder** address:

```ts
export const CONTACT_EMAIL = "hello@18nover.gay"; // PLACEHOLDER — not a live mailbox yet
```

That mailbox does **not** exist yet. The homepage “Email us” button and the contact form both open a `mailto:` link to this address. Until a real inbox is created and tested, visitors who send mail to it will not reach anyone.

There is no company phone number or street address on the site, by design.

## What to do next

1. Decide the addresses to create (recommended starting point: `hello@18nover.gay` as the public inbox). Add others later if needed (for example a private operators address).
2. Finish the Google Workspace (or Google mail) mailbox setup for the domain. DNS is the part that is already done; the mailbox itself is not.
3. Send and receive a test message.
4. Once the inbox works, leave `CONTACT_EMAIL` as `hello@18nover.gay` if that is the chosen public address, or update `lib/config.ts` and redeploy if the public address changes.
5. After the public inbox can receive mail, consider adding a `p=none` DMARC record that reports to it. See [Domain and DNS](dns.md).

Business email is also the recommended account email for later vendor signups (bank, payments, Cloudflare), rather than a personal inbox. Forming the LLC is not strictly required to create the mailbox, but it is the first item in the agreed company order of operations. See [Roadmap](roadmap.md).
