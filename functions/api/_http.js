/**
 * Response helpers with a same-origin CORS policy.
 *
 * Every endpoint previously sent `Access-Control-Allow-Origin: *`, including the
 * login and password-reset endpoints, which let any website on the internet call
 * them from a victim's browser. The site and its API share an origin, so the
 * default is now to send no ACAO header at all; extra origins must be listed
 * explicitly in the ALLOWED_ORIGINS environment variable.
 */

function allowedOrigins(request, env) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  // The deployment's own origin is always permitted.
  return new Set([new URL(request.url).origin, ...configured]);
}

export function corsHeaders(request, env, { methods = "GET, POST, OPTIONS", allowHeaders = "Content-Type" } = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };

  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(request, env).has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = methods;
    headers["Access-Control-Allow-Headers"] = allowHeaders;
    headers["Access-Control-Max-Age"] = "86400";
  }

  return headers;
}

/**
 * Bundles the CORS headers for one request with `json` and `preflight` helpers,
 * so an endpoint builds its policy once and every response inherits it.
 */
export function httpContext(request, env, options = {}) {
  const cors = corsHeaders(request, env, options);

  return {
    cors,
    json(body, status = 200, extra = {}) {
      return new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { ...cors, ...extra },
      });
    },
    preflight() {
      return new Response(null, { status: 204, headers: cors });
    },
  };
}
