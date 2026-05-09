# TV2 — channel guide, scraper & stack

Python tooling pulls live TV metadata from [aparatchi.com](https://www.aparatchi.com): stream URLs, proxy flags, and **logos stored locally** (no hotlinked URLs in JSON). The **React (Vite)** app is a channel guide with search, watch view, favorites, optional **drag-and-drop channel order** (saved in the browser), and **topic sections** driven by `ai_category` plus an optional **SQLite category admin** API.

---

## Contents

- [Repository layout](#repository-layout)
- [Quick start: Docker](#quick-start-docker)
- [Quick start without Docker](#quick-start-without-docker)
- [Backend API (`main:app`)](#backend-api-mainapp)
- [Category admin & SQLite](#category-admin--sqlite)
- [Frontend](#frontend)
- [Homepage behavior](#homepage-behavior)
- [Scrape, categorize & sync](#scrape-categorize--sync)
- [Channel JSON](#channel-json)
- [GitHub Actions](#github-actions)
- [HLS proxy (`gg.*`)](#hls-proxy-gg)
- [Notes](#notes)

---

## Repository layout

| Path | Purpose |
|------|---------|
| `backend/scrape.py` | Crawls categories, writes `channels.json`, downloads logos |
| `backend/ai_categorize.py` | Sets `ai_category` per channel (name/slug keywords + path hints; **no external API**) |
| `backend/sync_categories.py` | Ensures every `ai_category` in JSON exists in SQLite |
| `backend/main.py` | **FastAPI:** HLS proxy + `/api/categories` + HTTP Basic **admin** + `/admin` UI |
| `backend/hls_proxy.py` | HLS proxy router; legacy **`uvicorn hls_proxy:app`** = proxy only |
| `backend/data/channels.json` | Generated channel list |
| `backend/data/categories.db` | SQLite: section **labels**, **sort order**, **active** (optional; synced in CI) |
| `logo/` | Downloaded images referenced by relative paths in JSON |
| `frontend/` | React + Vite SPA |
| `docker-compose.yml`, `docker/` | **web** (nginx + static build) + **api** (FastAPI) |

---

## Quick start: Docker

Requires [Docker](https://docs.docker.com/get-docker/) with Compose v2. From the **repository root**:

```powershell
docker compose up --build
```

Open **http://localhost:8080** — the UI, **`/api`**, **`/proxy/hls`**, and **`/admin`** are served through nginx to one stack (no extra `VITE_*` needed in the image).

| Env (e.g. `.env` beside `docker-compose.yml`) | Purpose |
|-----------------------------------------------|--------|
| `WEB_PORT` | Host port for nginx (default **8080**) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Admin HTTP Basic (default password **`changeme`** — change it) |
| `ADMIN_SESSION_SECRET` | Optional; cookie signing for admin session |
| `CORS_ORIGINS` | Optional; passed to API |
| `CHANNELS_JSON_URL` | Optional; HTTP(S) URL — **`main.py` downloads `channels.json` at startup** (Docker or local). Disables background scrape when set (Compose `.env` or **`backend/.env`**). |
| `LOGOS_BASE_URL` | Optional — **`GET /api/config`** gives a prefix for every relative **`channel.logo`** path (CDN / other host). Omit to keep same-origin **`/logo/`** from nginx. |
| `SKIP_CHANNELS_FETCH` | Set to **`1`** to skip URL fetch, scraper, and seeding (volume must already contain **`channels.json`**). |
| `LOGO_DIR` | On the **api** container defaults to **`/data/logos`** (persisted **`logo-data`** volume, mounted read-only under **`/logo/`** on **web**). |
| `SCRAPE_ON_START` | **`once`** (default): run **`scrape.py`** on first boot only (until **`channels-data/.tv2_scraped`** exists). **`always`**: run on every **api** start. **`never`**: never scrape; use **`CHANNELS_JSON_URL`** or seed only. |
| `SCRAPE_DELAY` | Delay between requests for **`scrape.py`** (default **1** second). |

On **first container start** (no `CHANNELS_JSON_URL`, `SKIP_CHANNELS_FETCH` not set), the **api** entrypoint runs **`python scrape.py`**, writing **`channels.json`** and logos to the named volumes (same paths as manual `docker compose exec api python scrape.py`).

**Bake a scrape into the image** (needs network during `docker build`):

```powershell
$env:SCRAPE_AT_BUILD="1"
docker compose build --no-cache api
```

Or one-off: `docker build -f docker/Dockerfile.api --build-arg SCRAPE_AT_BUILD=1 .`

Stop: `docker compose down`. The **`category-db`** volume keeps **`categories.db`**; **`channels-data`** keeps **`channels.json`** and **`.tv2_scraped`**; **`logo-data`** keeps **`logo/`** files.

---

## Quick start without Docker

You run the **FastAPI** backend and the **Vite** frontend as two processes. The UI is at **http://localhost:5173**; the API (and HLS proxy for production-style testing) listens on **http://127.0.0.1:8787** by default.

**Prerequisites:** Python 3.11+ (or the version your team uses), **Node.js 20+**, and **`backend/data/channels.json`** (from the repo, **`CHANNELS_JSON_URL`** at startup, or **`python scrape.py`**). **`logo/`** supplies channel art. To refresh data, see [Scrape, categorize & sync](#scrape-categorize--sync).

### 1. Environment files

| File | Purpose |
|------|---------|
| **`backend/.env`** | Backend settings. Copy from **`backend/.env.example`** and edit. **`main.py`** loads this automatically via **`python-dotenv`**. |
| **`frontend/.env.local`** | Frontend-only `VITE_*` variables (optional for the default local setup). Copy from **`frontend/.env.example`**. Vite reads **`frontend/.env`** and **`frontend/.env.local`**; prefer **`.env.local`** for secrets (ignored by git when using the repo root **`.gitignore`**). |

```powershell
# From the repository root (PowerShell)
Copy-Item -Path backend\.env.example -Destination backend\.env
Copy-Item -Path frontend\.env.example -Destination frontend\.env.local
```

Set at least **`ADMIN_PASSWORD`** in **`backend/.env`** if you use **`/admin`**. Optional **`CHANNELS_JSON_URL`** (same file or shell env) makes **`uvicorn`** download **`channels.json` once at startup into **`CHANNELS_JSON_PATH`** (default **`backend/data/channels.json`**). Optional **`LOGOS_BASE_URL`** is exposed as **`GET /api/config`** so the SPA can load logos from a CDN or another host. Adjust **`VITE_DEV_API_PROXY`** or **`VITE_HLS_PROXY_BASE`** in **`frontend/.env.local`** only if the API runs somewhere other than **`http://127.0.0.1:8787`** or you serve a static build without Vite’s built-in HLS middleware (see [HLS proxy](#hls-proxy-gg)).

### 2. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8787
```

Endpoints: **`GET /api/categories`**, **`GET /api/config`**, **`GET /proxy/hls?url=…`**, **`GET /admin`** (with admin credentials). You can still override any variable with **`$env:VAR = "value"`** in the shell before **`uvicorn`**; the process environment wins over **`backend/.env`**.

### 3. Frontend (development)

In a **second** terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies **`/api`** to **`http://127.0.0.1:8787`** by default (or **`VITE_DEV_API_PROXY`**). HLS proxy routes for **`gg.*`** are handled in dev/preview by **`vite-plugin-hls-proxy.ts`**, so you do not need **`VITE_HLS_PROXY_BASE`** for **`npm run dev`** or **`npm run preview`**.

### 4. Frontend production build (optional)

```powershell
cd frontend
npm ci
npm run build
npm run preview
```

Keep **`uvicorn main:app`** running if you need the category API and admin; **`npm run preview`** still uses Vite’s dev-style HLS proxy plugin for **`/proxy/hls`**.

---

## Backend API (`main:app`)

Run locally (after [Quick start without Docker](#quick-start-without-docker) or the [Python setup](#python-setup) under [Frontend](#frontend)):

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --host 127.0.0.1 --port 8787
```

Admin credentials are read from **`backend/.env`** (see **`ADMIN_USER`** / **`ADMIN_PASSWORD`**) or from the process environment if set there.

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/categories` | None | Active categories for the SPA (order + labels) |
| `GET /api/config` | None | `{ logos_base_url }` from **`LOGOS_BASE_URL`** — prepended to each relative **`channel.logo`** in **`channels.json`** |
| `GET/POST/PATCH/DELETE /api/admin/categories` | HTTP Basic or `admin_session` cookie | CRUD categories |
| `POST /api/admin/session` | HTTP Basic | Sets `admin_session` cookie for the admin UI |
| `GET /admin`, `GET /api/admin` | HTTP Basic or cookie | Static HTML admin |
| `GET /proxy/hls?url=…` | None | HLS proxy for `gg.*` hosts (embedder headers) |

| Env | Purpose |
|-----|---------|
| `ADMIN_USER` | Default `admin` |
| `ADMIN_PASSWORD` | Required for admin to work; empty = admin disabled |
| `ADMIN_SESSION_SECRET` | HMAC for session cookie |
| `CATEGORY_DB_PATH` | SQLite path (default `backend/data/categories.db`) |
| `CORS_ORIGINS` | Comma-separated origins (default `*`) |
| `CHANNELS_JSON_URL` | Optional; downloaded into **`CHANNELS_JSON_PATH`** before routes respond |
| `CHANNELS_JSON_PATH` | Target path for that download (default `backend/data/channels.json`) |
| `SKIP_CHANNELS_FETCH` | Set **`1`** to skip **`CHANNELS_JSON_URL`** |
| `LOGOS_BASE_URL` | Optional absolute origin prepended to relative **`channel.logo`** paths — SPA reads **`GET /api/config`** |

---

## Category admin & SQLite

- **Homepage sections** match each channel’s **`ai_category`** slug to a row in **`categories`** (`slug`, `label`, `sort_order`, `active`).
- **Inactive** slugs are merged into **Other** on the guide.
- With **no API** (e.g. static GitHub Pages), the app uses a **built-in** topic order and labels.
- With the API (local, Docker, or `VITE_API_BASE` at build time), **`GET /api/categories`** drives order and labels.

**CI:** After each scrape, [`scrape-channels.yml`](.github/workflows/scrape-channels.yml) runs **`sync_categories.py`** so new `ai_category` values get rows; **`categories.db`** is committed when it changes.

---

## Frontend

**Requirements:** Node.js 20+.

### Python setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Development

```powershell
cd frontend
npm install
npm run dev
```

Default **http://localhost:5173**. Vite serves `backend/data/channels.json` and `logo/` from the parent repo. **`/api`** is proxied to **`http://127.0.0.1:8787`** (override with **`VITE_DEV_API_PROXY`**). On load, the app requests **`GET /api/config`** for **`LOGOS_BASE_URL`** unless **`VITE_LOGOS_BASE_URL`** is set.

### Production build

```powershell
cd frontend
npm ci
npm run build
npm run preview
```

`channels.json` and `logo/` are copied into `dist/` via Vite.

### Frontend environment variables

| Variable | When | Purpose |
|----------|------|---------|
| `VITE_BASE` | GitHub project Pages | Subpath e.g. `/repo/` (workflow sets this) |
| `VITE_API_BASE` | API on another origin | Full origin for `/api/categories` (no trailing slash). Omit if same origin (Docker or local combined stack). |
| `VITE_HLS_PROXY_BASE` | Static host **without** `/proxy` | Full URL to the **proxy base** ending with `/proxy/hls` (see [HLS](#hls-proxy-gg)) |
| `VITE_DEV_API_PROXY` | Local dev only | Where to proxy `/api` (default `http://127.0.0.1:8787`) |
| `VITE_LOGOS_BASE_URL` | Optional | Absolute URL prefix for relative **`channel.logo`** paths (overrides **`GET /api/config`**). Alternatively **`LOGOS_BASE_URL`** in **`frontend/.env`** (same name as backend; see **`vite.config`** **`envPrefix`**). |

### GitHub Pages

**You must turn on Pages for this repository before `deploy-pages` can succeed.** The error `Creating Pages deployment failed` / **HttpError: Not Found** means GitHub has no Pages site configured for **Actions** yet (the REST API returns 404 until this is done).

1. Open **`https://github.com/<owner>/<repo>/settings/pages`** (replace with your repo).
2. Under **Build and deployment → Source**, choose **GitHub Actions** (not “Deploy from a branch”). Save.
3. Run the workflow again (**Actions** tab → **Deploy frontend to GitHub Pages** → **Run workflow**, or push a commit that touches the workflow paths).

If the **`github-pages`** [environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) has **required reviewers**, approve the pending deployment for the **deploy** job.

After the first successful deploy, the site URL appears under **Settings → Pages** and in the workflow summary.

Other notes:

- Workflow: [`.github/workflows/deploy-github-pages.yml`](.github/workflows/deploy-github-pages.yml) sets **`VITE_BASE`**, builds, uploads `frontend/dist`. It does **not** use `actions/configure-pages` (that step also 404s until step 2 above is done).
- **`404.html`** duplicates `index.html` for client-side routes.

For a static Pages site **without** the API, the guide uses **fallback** topic ordering unless you build with **`VITE_API_BASE`** pointing at a hosted API.

---

## Homepage behavior

- **Sections** group channels by **`ai_category`**, ordered by the **category API** when available, otherwise by a fixed taxonomy order.
- **Favorites** block at the top (from `localStorage` **`tv2-favorites-v1`**).
- **Reorder channels** (clear search): flat list, drag-and-drop; order is **global** (CH numbers, sidebar, numpad) and stored under **`tv2-channel-order-v1`** in `localStorage`.
- **Style toolbar:** TV / Neon / Glass themes; thumbnail, list, or details layout (saved in the browser).

---

## Scrape, categorize & sync

Full crawl (paths from `backend/config.py` → `CATEGORY_PATHS`):

```powershell
python backend/scrape.py --delay 1 -o backend/data/channels.json
```

Assign topics (name/slug heuristics):

```powershell
python backend/ai_categorize.py -i backend/data/channels.json
```

Merge `ai_category` slugs into SQLite (for admin / CI):

```powershell
python backend/sync_categories.py
```

`CHANNELS_JSON` can point at a non-default JSON path.

---

## Channel JSON

Each channel includes: `name`, `stream_url`, `stream_type`, `stream_host`, `requires_proxy`, `page_url`, `category_path`, `slug`, **`logo`** (repo-relative path, e.g. `logo/...svg`), optional **`media_type`**, and after categorization **`ai_category`**, **`ai_labeled_at`**. The payload may include **`ai_taxonomy`** and **`ai_model`** (e.g. `name-heuristic-v1`).

---

## GitHub Actions

| Workflow | Role |
|----------|------|
| [`scrape-channels.yml`](.github/workflows/scrape-channels.yml) | On a schedule and **workflow_dispatch**: scrape → **`ai_categorize.py`** → **`sync_categories.py`** → commit **`channels.json`**, **`categories.db`**, **`logo/`** if changed |
| [`deploy-github-pages.yml`](.github/workflows/deploy-github-pages.yml) | Build frontend and deploy to Pages when relevant paths change |

Workflows need **contents: write** where they push (see repo **Settings → Actions → Workflow permissions**).

---

## HLS proxy (`gg.*`)

CDNs often return **403** unless requests use the same **Origin / Referer** as the embedder (`https://www.aparatchi.com`).

| Mode | What to use |
|------|-------------|
| **Vite dev / `npm run preview`** | Built-in **`/proxy/hls`** in [`vite-plugin-hls-proxy.ts`](frontend/vite-plugin-hls-proxy.ts) |
| **Docker / `main:app` behind nginx** | Browser uses **same origin**; no `VITE_HLS_PROXY_BASE` needed. The bundled [`nginx.conf`](docker/nginx.conf) forwards **`Host` with port** (`$http_host`) so rewritten playlist URLs stay on the same host:port (using `$host` alone drops the port and breaks segments). |
| **Static hosting only** | Run **`hls_proxy.py`** or **`main:app`** somewhere and build with e.g. `VITE_HLS_PROXY_BASE=http://your-host:8787/proxy/hls` |

FastAPI alone: `uvicorn hls_proxy:app --host 127.0.0.1 --port 8787` (proxy only). Full stack: **`uvicorn main:app`** (proxy + API + admin).

---

## Notes

- Respect the source site’s terms of use; keep scrape **`--delay`** reasonable.
- **`requires_proxy: true`** streams expect the HLS proxy path above.
- Re-running the scraper overwrites matching files under `logo/`.
