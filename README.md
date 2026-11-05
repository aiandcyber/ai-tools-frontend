# AI Tools — Frontend

React + Vite UI for **AI-for All Tools**.

- **GitHub:** https://github.com/aiandcyber/ai-tools-frontend  
- **Production host (planned):** Cloudflare Pages → `tools.ai-forall.org`  
- **Backend API:** set `VITE_API_BASE` to the public API origin (e.g. `https://api.tools.ai-forall.org`)  


## Local development

```bash
npm install
cp .env.example .env   # optional
npm run dev            # http://127.0.0.1:5174  (proxies /api → VITE_API_TARGET)
```

## Production build

```bash
npm ci
npm run build          # output: dist/
```

## Cloudflare Pages (GitHub)

Connect [ai-tools-frontend](https://github.com/aiandcyber/ai-tools-frontend) in the Cloudflare dashboard:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` (repo root) |
| Node version | `20` or `22` (Compatibility / `NODE_VERSION`) |

### Build environment variables

| Variable | Example |
|---|---|
| `VITE_API_BASE` | `https://api.tools.ai-forall.org` (no trailing slash) |
| `VITE_PORTAL_URL` | `https://ai-forall.org` |
| `VITE_AUTH0_DOMAIN` | `dev-tvq4tbikhbet8orb.us.auth0.com` |
| `VITE_AUTH0_CLIENT_ID` | Tools SPA Client ID |
| `VITE_AUTH0_AUDIENCE` | `https://api.ai-forall.org` |
| `VITE_AUTH_REQUIRED` | `true` |
| `VITE_TURNSTILE_SITEKEY` | Cloudflare Turnstile sitekey (search + contact) |

Also add production Callback / Logout / Web Origins on the Auth0 SPA: `https://tools.ai-forall.org`.

### Search (casual users)

Anonymous Search does **not** require Sign in. The SPA gets an invisible Turnstile token (action `search`) and sends it as `cf-turnstile-response` on `POST /api/search`. The API also rate-limits by IP. Signed-in users (Auth0 Bearer) skip the casual Turnstile path.

`wrangler.jsonc` sets `assets.not_found_handling` to `single-page-application`, so unknown paths serve `index.html`. Do not add a `/* /index.html 200` rule in `_redirects`; Workers rejects it as a loop.

## First push to GitHub (run yourself)

From this folder (`ai-tools/frontend`), after the empty repo exists:

```bash
git init
git add .
git commit -m "Initial AI Tools frontend"
git branch -M main
git remote add origin https://github.com/aiandcyber/ai-tools-frontend.git
git push -u origin main
```

Do **not** commit `.env` or secrets.
