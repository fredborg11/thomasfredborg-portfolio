# Thomas Fredborg Portfolio CMS

This folder contains the private admin CMS for the portfolio.

## Architecture

- The public portfolio remains Astro + GitHub Pages.
- The CMS runs as a Cloudflare Worker with static assets.
- The CMS writes case Markdown and media directly to the GitHub repository through a GitHub App.
- Runtime secrets are stored in Cloudflare Worker Secrets.

## Cloudflare build settings

Connect the repository to a Cloudflare Worker with:

- Root directory: `cms`
- Build command: leave empty
- Deploy command: `npx wrangler deploy`
- Production branch: `main`

## Runtime configuration

Add:

- `GITHUB_APP_ID` — GitHub App ID
- `GITHUB_PRIVATE_KEY` — GitHub App private key (Secret)
- `ADMIN_PASSWORD` — CMS password (Secret)

Optional:

- `SESSION_SECRET` — separate secret used to sign the login cookie

The GitHub App only needs repository permissions for this portfolio repository:

- Contents: Read & write
- Metadata: Read-only

Install the app on `fredborg11/thomasfredborg-portfolio` only.

The CMS upload limit is 25 MB per file. This is intentionally below the Cloudflare and GitHub hard limits so portfolio media stays manageable.
