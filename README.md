# 18nover

Company website for **18nover**, the parent company behind [OnlyMen](https://onlymen.gay). Built to ship at [18nover.gay](https://18nover.gay).

## Stack

Next.js (App Router) with the OnlyMen brand tokens: ink / gold / oxblood, Cormorant Garamond, and Manrope. Crest artwork lives in `public/`.

## Local development

```bash
npm install
npm run dev
```

The site is a Next.js static export. `npm run build` writes HTML to `out/`. `npm run preview` (or `npm start`) serves that export through Wrangler after a build. `npm run deploy` publishes the Worker to the `18nover` Cloudflare account’s workers.dev preview only — it does not change `18nover.gay` DNS or the Vercel project. See [`docs/cloudflare.md`](docs/cloudflare.md).

## Config

All public URLs and the contact address live in `lib/config.ts`.

`CONTACT_EMAIL` (`hello@18nover.gay`) is a **placeholder**. Replace it once the mailbox exists. Do not add phone numbers or a street address unless they are real.

Product and legal links point at the OnlyMen brand domain (`onlymen.gay`).

## Documentation

Company, domain, deploy, and roadmap notes live in [`docs/`](docs/README.md).

## Legal

Footer Terms, Privacy, 2257, and Guidelines links go to OnlyMen’s existing pages. Those pages are still drafts pending lawyer review.
