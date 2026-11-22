# Stack and architecture

The live company site in this repo is a small Next.js marketing site. It replaced an older RTSP camera-streaming app in commit `fbbfdbe` (Saturday, Nov 21, 2026). That older app remains in git history; the replacement was a normal commit, not a force-push. Commit `bdd90b8` then pointed product, join, and legal links at `https://onlymen.gay` once that domain was live with HTTPS.

## Runtime

| Piece | What is actually in the repo |
|---|---|
| Framework | Next.js 15 App Router (`next` `^15.5.6` in `package.json`) |
| UI | React 19 (`react` / `react-dom` `^19.2.0`) |
| Language | TypeScript (`tsconfig.json`, `next-env.d.ts`) |
| Config | `next.config.ts` — `reactStrictMode: true` only. No `output: "export"` yet, no redirects, no image loader override |
| Fonts | `next/font/google`: Cormorant Garamond and Manrope, wired in `app/layout.tsx` |
| Styling | Global CSS in `app/globals.css` (design tokens, no Tailwind, no CSS-in-JS) |
| Data / backend | **None.** No database, no ORM, no env-var secrets, no `app/api` routes, no `vercel.json` |
| Contact | Client-side form in `components/contact-form.tsx`. Submit builds a `mailto:` URL and hands it to the browser. Nothing is posted to a server |

Scripts: `npm run dev` (`next dev`), `npm run build` (`next build`), `npm run start` (`next start`).

## Site structure

There is a single route: `app/page.tsx`.

- Header: About, Products, Contact, plus a “Visit OnlyMen” link (`components/header.tsx`)
- Hero: “Built for Men. Made for Grown-Ups.”
- About, products (OnlyMen), trust/safety strip, contact
- Footer legal links currently go to OnlyMen’s pages (see [Company legal pages](legal.md))

Public copy, product URLs, and the contact address all live in `lib/config.ts`. Change URLs there rather than scattering them through components.

`app/layout.tsx` sets metadata for 18nover.gay (Open Graph, Twitter card, favicons, adult `RTA-5042-1996-1400-1570-RTA` rating labels). `metadataBase` is `https://18nover.gay`.

## Assets

Crest, favicon, Open Graph image, and flourish artwork live in `public/`:

- `crest.png`, `crest-1024.png`, `crest-full-1024.png`, `crest-icon-512.png`, `crest-icon-1024.png`
- `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`
- `og.jpg`, `flourish.svg`

## What this architecture implies

Because the contact form only opens a mail client, the site has no inbox of its own and no spam or storage concerns on the server. It also means messages only send if the visitor has a working mail client, and they go to whatever `CONTACT_EMAIL` is set to — currently a placeholder, not a live mailbox. See [Business email](business-email.md).

The same simplicity is why the planned Cloudflare path prefers a static export. See [Roadmap](roadmap.md#planned-cloudflare-move).
