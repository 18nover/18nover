# 18nover

Company website for **18nover**, the parent company behind [OnlyMen](https://onlymen.vercel.app). Built to ship at [18nover.gay](https://18nover.gay).

## Stack

Next.js (App Router) with the OnlyMen brand tokens: ink / gold / oxblood, Cormorant Garamond, and Manrope. Crest artwork lives in `public/`.

## Local development

```bash
npm install
npm run dev
```

## Config

All public URLs and the contact address live in `lib/config.ts`.

`CONTACT_EMAIL` (`hello@18nover.gay`) is a **placeholder**. Replace it once the mailbox exists. Do not add phone numbers or a street address unless they are real.

Product and legal links currently point at the live OnlyMen deployment (`onlymen.vercel.app`). After `onlymen.gay` DNS is pointed at the OnlyMen Vercel project, those URLs can be switched to the brand domain.

## Legal

Footer Terms, Privacy, 2257, and Guidelines links go to OnlyMen’s existing pages. Those pages are still drafts pending lawyer review.
