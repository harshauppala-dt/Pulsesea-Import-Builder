// One Worker that does two jobs:
//   1. Serves the Samsung Import Builder page (files in /public).
//   2. Handles POST /proxy: forwards the page's API calls to DispatchTrack
//      server-to-server, so the browser never hits CORS.
//
// The page and /proxy share one address, so no CORS headers are needed.

// Only these domains (and their subdomains) can be called through /proxy.
// If your DispatchTrack host is on a different domain, add it here.
const ALLOWED_HOST_SUFFIXES = ['dispatchtrack.com'];

function isHostAllowed(hostname) {
  return ALLOWED_HOST_SUFFIXES.some((s) => hostname === s || hostname.endsWith(`.${s}`));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function handleProxy(request, selfUrl) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Only accept calls made by the page itself (browsers send Origin on POST).
  const origin = request.headers.get('Origin');
  if (origin !== selfUrl.origin) return json({ error: 'Origin not allowed' }, 403);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { url, method, headers, body } = payload || {};
  let target;
  try {
    target = new URL(url);
  } catch {
    return json({ error: 'Invalid target URL' }, 400);
  }
  if (target.protocol !== 'https:') return json({ error: 'Only https targets are allowed' }, 400);
  if (!isHostAllowed(target.hostname)) return json({ error: `Target host not allowed: ${target.hostname}` }, 403);

  const upstreamHeaders = new Headers();
  for (const [k, v] of Object.entries(headers || {})) {
    if (typeof v === 'string') upstreamHeaders.set(k, v);
  }
  const upstreamMethod = typeof method === 'string' ? method.toUpperCase() : 'GET';

  let res;
  try {
    res = await fetch(target.toString(), {
      method: upstreamMethod,
      headers: upstreamHeaders,
      body: upstreamMethod === 'GET' || upstreamMethod === 'HEAD' ? undefined : body,
      redirect: 'follow',
    });
  } catch (err) {
    return json({ error: `Upstream request failed: ${err && err.message ? err.message : String(err)}` }, 502);
  }

  const resHeaders = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });
  return json({ status: res.status, statusText: res.statusText, headers: resHeaders, body: await res.text() });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/proxy') return handleProxy(request, url);
    return env.ASSETS.fetch(request);
  },
};
