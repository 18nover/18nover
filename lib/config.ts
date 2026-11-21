/**
 * Site-wide contact and product URLs.
 *
 * CONTACT_EMAIL is a PLACEHOLDER. Replace it with the real inbox once
 * hello@18nover.gay (or another address) is set up and receiving mail.
 * Do not invent phone numbers or street addresses.
 */
export const CONTACT_EMAIL = "hello@18nover.gay"; // PLACEHOLDER — not a live mailbox yet

export const site = {
  name: "18nover",
  domain: "18nover.gay",
  url: "https://18nover.gay",
  tagline: "Built for Men. Made for Grown-Ups.",
  description:
    "18nover is an adults-only company, built by and for gay men. We are the parent company behind OnlyMen, a creator-first platform for adult men.",
} as const;

export const onlymen = {
  name: "OnlyMen",
  brandDomain: "onlymen.gay",
  /** Live URL until onlymen.gay DNS is pointed at the OnlyMen project. */
  url: "https://onlymen.vercel.app",
  joinCreator: "https://onlymen.vercel.app/join?as=creator",
  legal: {
    terms: "https://onlymen.vercel.app/terms",
    privacy: "https://onlymen.vercel.app/privacy",
    statement2257: "https://onlymen.vercel.app/2257",
    guidelines: "https://onlymen.vercel.app/guidelines",
  },
} as const;
