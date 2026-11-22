# Company legal pages

## What the company site does today

`18nover.gay` does **not** have its own Terms, Privacy, 2257, or Community Guidelines pages.

The footer and the trust strip link out to OnlyMen’s existing product pages on `onlymen.gay`:

- Terms — `https://onlymen.gay/terms`
- Privacy — `https://onlymen.gay/privacy`
- 18 U.S.C. § 2257 — `https://onlymen.gay/2257`
- Guidelines — `https://onlymen.gay/guidelines`

Those URLs are defined in `lib/config.ts`. The root README already notes that the OnlyMen pages are still drafts pending lawyer review.

The company homepage itself is marked as adult content (RTA meta labels in `app/layout.tsx`) and states that 18nover products are for adults only.

## What still needs to be written

Company-level pages on `18nover.gay` are an open item, after the LLC (and usually the EIN and a real contact mailbox) so the documents can use the real legal name and a real contact address.

Expected company-side pages, to be drafted and then reviewed by a lawyer before they are treated as final:

- Company Terms of Use
- Company Privacy Policy
- Any company-level 2257 / records-keeping statement that belongs on the parent site rather than only on OnlyMen
- A contact or legal-notice path that uses a live `18nover.gay` inbox

Until those exist, do not invent legal copy in this repo just to fill the footer. Keep linking to the product pages, and keep labeling those product pages as drafts until counsel has reviewed them.

Legal work for the OnlyMen *product* stays with the OnlyMen bot and the `18nover/onlymen` repo. Company-level pages for `18nover.gay` stay with the 18nover bot. See [Bot ownership](ownership.md).
