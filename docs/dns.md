# Domain and DNS

**Domain:** `18nover.gay`  
**Registrar and authoritative DNS:** Porkbun (Porkbun nameservers).  
**Renewal (as of Nov 21, 2026):** expires July 19, 2027, auto-renew on.

DNS was last retrieved from the Porkbun API on Saturday, Nov 21, 2026, about 9:28 PM America/New_York. Record contents below omit public key material and verification tokens; those values already exist in DNS and should not be copied into git.

## Current records

Vercel hosting records (added for this site; TTL 600):

| Type | Name | Value |
|---|---|---|
| A | `18nover.gay` (apex) | `216.198.79.1` |
| A | `18nover.gay` (apex) | `64.29.17.1` |
| CNAME | `www.18nover.gay` | `b0ed6eb64b10e364.vercel-dns-017.com` |

Pre-existing Google / registrar records, left unchanged when Vercel records were added:

| Type | Name | Value |
|---|---|---|
| MX | `18nover.gay` | `smtp.google.com` (priority 1, TTL 600) |
| TXT | `18nover.gay` | SPF: `v=spf1 include:_spf.google.com ~all` |
| TXT | `18nover.gay` | Google site verification |
| TXT | `google._domainkey.18nover.gay` | Google DKIM (`v=DKIM1; k=rsa; p=…`) — **two records; see below** |
| NS | `18nover.gay` | `curitiba`, `fortaleza`, `maceio`, and `salvador`.porkbun.com (TTL 86400) |

There is **no** `_dmarc.18nover.gay` record.

A copy of the pre-Vercel zone is kept on the shared workspace as a backup; do not commit raw API responses or secrets into this repo.

## Duplicate Google DKIM

Porkbun currently has **two TXT records** at `google._domainkey.18nover.gay`.

- They carry the **same RSA public key**.
- They differ only in spacing after the semicolons: one is `v=DKIM1; k=rsa; p=…` and the other is `v=DKIM1;k=rsa;p=…`.
- After whitespace is ignored, the two records are identical.

This is leftover duplication, not two different keys. It should be cleaned up by **deleting exactly one** of the two TXT records and leaving the other in place. Do not delete both, and do not edit the remaining `p=` value. This cleanup was documented, not performed, as part of writing these docs.

## Optional DMARC

Once `hello@18nover.gay` (or another real 18nover inbox) can receive mail, add a conservative DMARC record, for example a TXT at `_dmarc.18nover.gay` starting with `p=none` and a `rua` address that someone actually reads. That is a monitoring policy only; tightening it (`p=quarantine` / `p=reject`) should wait until SPF and the remaining DKIM record are confirmed to pass in real mail.

Do not add DMARC until that reporting mailbox exists, or reports will go nowhere.

## Related Vercel behavior

HTTPS at both the apex and `www` is live on Vercel. The `www` hostname still answers 200 rather than redirecting; the 308 has to be set on the Vercel project domain, not in Porkbun. See [Vercel project and deploys](vercel.md).
