# Vercel project and deploys

Hosting today is on Vercel, under the **18nover** team. Production is [https://18nover.gay](https://18nover.gay).

## Project

| Item | Value |
|---|---|
| Team | `18nover` |
| Project name | `18nover` (renamed from `18nover-site`) |
| Framework (Vercel) | Next.js |
| Git | This repository, `https://github.com/18nover/18nover` |
| Deploy | Git push to `main` deploys production |
| Preview protection | SSO protection is enabled for preview deployments; production is public |

The project was created as `18nover-site` and later renamed to `18nover` after the official repo was connected. A temporary `18nover-site` GitHub repository was used during early work and has been deleted. This repo is the source of truth.

The latest production deployment checked on Saturday, Nov 21, 2026, about 9:28 PM America/New_York, was serving the `bdd90b8` site (HTTPS, `server: Vercel`).

## Custom domains on the project

Verified project domains as of that check:

- `18nover.gay` — production, no redirect
- `www.18nover.gay` — production, **no redirect configured** (`redirect` and `redirectStatusCode` are both empty)
- `18nover.vercel.app` — default production alias after the rename

`www.18nover.gay` currently returns **HTTP 200** with the same page as the apex. The planned **308 redirect from `www` to `https://18nover.gay` is still pending in the Vercel UI**. Do not point DNS away from Vercel until that is set, or visitors will keep seeing a 200 on `www`.

## Leftover aliases from the rename

These were the leftover hostnames called out after the project was renamed from `18nover-site`:

| Hostname | Status on Nov 21, 2026, 9:28 PM America/New_York |
|---|---|
| `18nover-site.vercel.app` | **Already gone.** Not in the project alias list. `get_alias` returns 404. HTTPS request returns 404 `DEPLOYMENT_NOT_FOUND`. Nothing to remove. |
| `18nover-site-18nover.vercel.app` | **Still assigned** to this project. Serves the company site over HTTPS 200, with `x-robots-tag: noindex`. It still points at an older deployment from before the latest production promote (`dpl_6yrUhi8MauyZP5tgf1oZHBR8VvCL`), not the current production deployment. |

A removal of those two aliases was attempted on that same evening. The Vercel MCP connector can list and read aliases but **does not expose a delete/remove-alias tool**. The Vercel CLI is not installed or authenticated on the shared box, so the alias could not be removed from here. Only those two names were in scope; nothing else was changed.

The current default aliases `18nover.vercel.app` and `18nover-git-main-18nover.vercel.app` should be left alone. There is also an `18nover-18nover.vercel.app` alias still pointing at the same older deployment as the leftover `18nover-site-…` name. It was **not** removed, because it was outside the agreed scope.

To finish retiring `18nover-site-18nover.vercel.app`, remove that alias in the Vercel dashboard (Project → Domains / Aliases) or with an authenticated `vercel alias rm 18nover-site-18nover.vercel.app`. Do not delete `18nover.vercel.app`, `18nover.gay`, or `www.18nover.gay`.
