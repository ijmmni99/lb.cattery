// L&B Cattery service worker. Bump CACHE_VERSION on every deploy that changes cached files.
const CACHE_VERSION = "v1";
const CACHE_NAME = `lb-cattery-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/admin.html",
  "/booking-lookup.html",
  "/user-login.html",
  "/offline.html",
  "/styles.css",
  "/site.js",
  "/script.js",
  "/admin.js",
  "/booking-lookup.js",
  "/user-login.js",
  "/offline.js",
  "/manifest.webmanifest",
  "/assets/fonts/poppins-400.woff2",
  "/assets/fonts/poppins-500.woff2",
  "/assets/fonts/poppins-600.woff2",
  "/assets/fonts/poppins-700.woff2",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/icon-maskable-512.png",
  "/assets/icons/apple-touch-icon.png",
  "/assets/logo-256.webp",
  "/assets/logo-256.jpg",
];

// Cloudflare Pages redirects /page.html to /page. A redirected response cannot be served to a navigation
// request, so store a copy without the "redirected" flag.
async function cleanResponse(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE_URLS.map(async (url) => {
      const response = await fetch(new Request(url, { cache: "reload" }));
      if (!response.ok) throw new Error(`precache failed for ${url}: ${response.status}`);
      await cache.put(url, await cleanResponse(response));
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("lb-cattery-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, await cleanResponse(response.clone()));
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  const response = await network;
  if (response) return response;
  if (request.mode === "navigate") return (await cache.match("/offline.html")) || Response.error();
  return Response.error();
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/api/settings") {
    event.respondWith(networkFirst(request));
    return;
  }

  // Never cache any other API call.
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  const isDocument = request.mode === "navigate" || request.destination === "document";
  if (isDocument || /\.(?:html|css|js)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
