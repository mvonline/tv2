# Edge video proxy and GitHub image CDN setup

This guide deploys the new bandwidth-saving architecture from branch
`feat/edge-hls-proxy`.

```text
Video:  viewer -> Cloudflare Worker/cache -> authorized upstream HLS CDN
Images: viewer -> jsDelivr CDN -> public GitHub repository
API:    viewer -> Render -> categories, admin, analytics, health
```

The result is that Render no longer sends video bytes to every viewer. The
FastAPI HLS proxy remains available as an emergency fallback.

Only proxy streams you are authorized to access and redistribute.

## 1. Prerequisites

- A Cloudflare account with Workers enabled.
- Node.js 22 or newer for the Worker tooling.
- A public GitHub repository. The automatic jsDelivr image URL cannot read a
  private repository.
- The existing Render API URL: `https://bctv2.onrender.com`.
- GitHub Pages configured to deploy with GitHub Actions.

Check out the implementation branch:

```bash
git switch feat/edge-hls-proxy
```

## 2. Deploy the Cloudflare Worker

From the repository root:

```bash
cd edge-proxy
npm ci
npx wrangler login
npm test
npm run deploy
```

Complete the browser authorization requested by `wrangler login`. The deploy
command prints an address similar to:

```text
https://tv2-hls-edge.<cloudflare-subdomain>.workers.dev
```

Save this address. It is referred to as `WORKER_ORIGIN` below.

## 3. Test the Worker

Health check:

```bash
curl https://tv2-hls-edge.<cloudflare-subdomain>.workers.dev/healthz
```

Expected response:

```json
{"status":"ok"}
```

Test an HLS master playlist that you are authorized to proxy:

```bash
curl --get \
  --data-urlencode "url=https://<allowed-host>/<path>/playlist.m3u8" \
  https://tv2-hls-edge.<cloudflare-subdomain>.workers.dev/proxy/hls
```

The returned playlist should contain Worker URLs rather than direct segment
URLs. Playlist responses have `X-TV2-Edge-Cache: BYPASS`. A segment's first
response has `MISS`; a repeated request at the same Cloudflare edge should have
`HIT`.

## 4. Configure GitHub Pages

Open the repository on GitHub, then go to:

**Settings -> Secrets and variables -> Actions -> Variables**

Create these repository variables:

| Variable | Value | Required |
| --- | --- | --- |
| `HLS_PROXY_BASE` | `WORKER_ORIGIN/proxy/hls` | Yes |
| `HAS_API` | `true` | Recommended |
| `API_BASE` | `https://bctv2.onrender.com` | Recommended |
| `LOGOS_BASE_URL` | Leave unset | No |

Example HLS value:

```text
https://tv2-hls-edge.example.workers.dev/proxy/hls
```

`LOGOS_BASE_URL` should normally remain unset. The Pages workflow automatically
generates an immutable URL for the exact deployment commit:

```text
https://cdn.jsdelivr.net/gh/<owner>/<repository>@<commit-sha>
```

Channel logo paths already contain `logo/`, so a channel automatically resolves
to a URL such as:

```text
https://cdn.jsdelivr.net/gh/mvonline/tv2@<commit-sha>/logo/example.svg
```

If you use a different image CDN, set `LOGOS_BASE_URL` to the repository-root
prefix without a trailing slash.

## 5. Deploy the frontend

Merge the branch to `main`, or push it and manually run the Pages workflow for
the branch while reviewing it:

1. Open **Actions** in GitHub.
2. Select **Deploy frontend to GitHub Pages**.
3. Select **Run workflow**.
4. Choose the desired branch.
5. Wait for both the build and deploy jobs to finish.

The build reads the repository variables above. When the image CDN is enabled,
the build intentionally stops copying the hundreds of local logo files into the
Pages artifact.

## 6. Configure Render as API-only

In the Render dashboard, open the `bctv2` web service.

Set the health check path under the service's advanced settings:

```text
/healthz
```

Recommended environment variables:

```text
CORS_ORIGINS=https://tv2.vafa.one
ANALYTICS_DEDUPE_SECONDS=30
HLS_SEGMENT_CACHE_MB=0
HLS_MAX_SEGMENT_BUFFERS=0
```

Use the actual frontend origin if it differs from `https://tv2.vafa.one`. Setting
the two HLS values to zero prevents Render from retaining video segments now
that normal viewers use the Worker. The Render HLS route still streams on a
cache miss if used as an emergency fallback.

Redeploy Render after changing its environment variables.

## 7. Verify production routing

Open the deployed site and use browser developer tools:

1. Open **Network**.
2. Start a channel with `requires_proxy: true`.
3. Filter for `m3u8` or `proxy/hls`.
4. Confirm playlist and segment requests use the Worker hostname, not
   `bctv2.onrender.com`.
5. Filter for `svg`, `png`, or `jpg`.
6. Confirm logo requests use `cdn.jsdelivr.net`.
7. Confirm API calls such as `/api/analytics/view` still use Render.

Check Render's authenticated runtime report:

```bash
curl -u '<admin-user>:<admin-password>' \
  https://bctv2.onrender.com/api/admin/runtime
```

After normal viewing, `active_upstream_segments` should remain zero and Render's
outbound-bandwidth graph should no longer grow at video-stream rates.

## 8. Monitor limits

- Monitor Worker requests in the Cloudflare dashboard. Playlist and segment
  requests count even when a segment is served from edge cache.
- Monitor Render's **Metrics -> Outbound Bandwidth** graph. It should now mostly
  represent small API responses.
- Monitor GitHub Actions after each deploy to confirm the commit-pinned image CDN
  URL was produced successfully.

## 9. Roll back safely

To send video through Render again:

1. Change the GitHub repository variable `HLS_PROXY_BASE` to:

   ```text
   https://bctv2.onrender.com/proxy/hls
   ```

2. Run the Pages deployment workflow again.
3. If necessary, restore Render's cache settings:

   ```text
   HLS_SEGMENT_CACHE_MB=32
   HLS_MAX_SEGMENT_BUFFERS=2
   ```

To stop using jsDelivr, set `LOGOS_BASE_URL` to the origin that hosts the
repository's `logo/` directory, or change the workflow to omit
`VITE_LOGOS_BASE_URL`; the frontend will fall back to its bundled logo files on
the next build.
