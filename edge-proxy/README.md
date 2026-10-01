# TV2 edge HLS proxy

This Cloudflare Worker moves authorized HLS delivery away from the Render web
service. Render can remain online for the category/admin/analytics API without
relaying video bytes to every viewer.

Only proxy streams you are permitted to access and redistribute. The Worker
does not grant rights to third-party content.

## Traffic path

```text
Browser -> Cloudflare Worker/cache -> upstream HLS CDN
Browser -> Render                 -> API and analytics only
```

Media segments are cached for 60 seconds at the edge. Nimble's volatile
`nimblesessionid` is excluded from the cache identity, while the original URL
including that session remains on the upstream request. Playlists are never
edge-cached because they describe a moving live window.

## Deploy

Requires Node.js 22+ and a Cloudflare account.

```bash
cd edge-proxy
npm ci
npx wrangler login
npm test
npm run deploy
```

Wrangler prints a URL similar to:

```text
https://tv2-hls-edge.<account>.workers.dev
```

The frontend proxy value is that origin plus `/proxy/hls`:

```text
https://tv2-hls-edge.<account>.workers.dev/proxy/hls
```

Test the deployment before rebuilding the frontend:

```bash
curl https://tv2-hls-edge.<account>.workers.dev/healthz
```

## Connect GitHub Pages

In the GitHub repository, open **Settings -> Secrets and variables -> Actions ->
Variables** and create:

```text
HLS_PROXY_BASE=https://tv2-hls-edge.<account>.workers.dev/proxy/hls
```

Run the **Deploy frontend to GitHub Pages** workflow again. Its production build
passes this value as `VITE_HLS_PROXY_BASE`; channels with `requires_proxy: true`
then use the Worker instead of Render.

To keep categories and analytics on Render, optionally add these repository
variables too:

```text
HAS_API=true
API_BASE=https://bctv2.onrender.com
```

For another frontend host, set the same value in its build environment:

```text
VITE_HLS_PROXY_BASE=https://tv2-hls-edge.<account>.workers.dev/proxy/hls
```

## Rollback

Set `HLS_PROXY_BASE` back to
`https://bctv2.onrender.com/proxy/hls` and rebuild the frontend to temporarily
return video traffic to Render. Removing the value entirely is only appropriate
when the frontend and a working proxy share the same origin. No Render settings
or DNS records are changed by this branch.

## Limits

Every playlist or segment request still counts as a Worker request, including
cache hits. Check usage in the Cloudflare dashboard. Edge caching reduces
upstream and origin bandwidth, but it cannot reduce the bytes received by each
viewer while they continuously watch a fixed-bitrate stream.
