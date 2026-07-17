# Phase 6 — Cookies, CORS and HTTP security headers

This step makes the browser-facing security boundary explicit. It does not change the session
model: the refresh token remains an opaque, server-validated cookie and the CSRF token remains
session-bound.

## Cookie contract

Both the refresh-session cookie and the CSRF cookie are:

- `HttpOnly`;
- `Secure` in production;
- host-only in production;
- scoped to `Path=/`;
- configured with one shared `SameSite` policy;
- deleted with exactly the same attributes used at creation.

Production automatically enables the `__Host-` prefix through `COOKIE_HOST_PREFIX`. This prevents
a subdomain from replacing the cookie and requires `Secure`, no `Domain`, and `Path=/`.

Default local configuration:

```env
SESSION_COOKIE_SECURE=false
COOKIE_HOST_PREFIX=false
COOKIE_SAMESITE=lax
COOKIE_PATH=/
COOKIE_DOMAIN=
```

Recommended production configuration:

```env
SESSION_COOKIE_SECURE=true
COOKIE_HOST_PREFIX=true
COOKIE_SAMESITE=lax
COOKIE_PATH=/
COOKIE_DOMAIN=
```

Use `COOKIE_SAMESITE=none` only when the frontend and API are genuinely cross-site. The backend
rejects that mode unless secure cookies are enabled. `Strict` is supported when the product
navigation and deployment topology have been tested with it.

Changing to `__Host-` cookie names invalidates existing unprefixed browser sessions. Plan the
rollout as a normal forced reauthentication.

## Host header validation

`TRUSTED_HOSTS` is enforced before application routing. Production must provide the public API
host or a reviewed leading wildcard such as `*.api.example.com`; the unrestricted `*` value and
the TestClient host are rejected in production.

```env
TRUSTED_HOSTS=api.example.com
```

Configure the ASGI server or ingress to pass the original host correctly. Do not trust arbitrary
forwarded host headers from the public internet.

## CORS

Credentialed CORS uses an exact origin allowlist. Wildcard origins are never accepted in
production. Request headers are also explicit rather than `*`:

```env
CORS_ALLOWED_ORIGINS=https://app.example.com
CORS_ALLOWED_HEADERS=Accept,Accept-Language,Cache-Control,Content-Language,Content-Type,Last-Event-ID,Pragma
CORS_MAX_AGE_SECONDS=600
```

The configured request-ID and CSRF header names are appended automatically. Cookie, Host, Origin
and Set-Cookie cannot be added to the request-header allowlist. Preflight responses use the
configured maximum age and preserve `Vary: Origin` behavior from Starlette's CORS middleware.

## Response headers

Every response, including errors, CORS rejections and invalid Host responses, receives:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
X-Permitted-Cross-Domain-Policies: none
X-DNS-Prefetch-Control: off
Origin-Agent-Cluster: ?1
```

Interactive `/docs` and `/redoc` pages are exempt from the API-only CSP in development. API docs
are disabled by default in production and startup rejects explicitly enabling them there.

HSTS defaults to enabled in production:

```env
HSTS_ENABLED=true
HSTS_MAX_AGE_SECONDS=31536000
HSTS_INCLUDE_SUBDOMAINS=true
HSTS_PRELOAD=false
```

Do not enable preload until every current and future subdomain is HTTPS-only and the operational
consequences have been reviewed. HSTS must be emitted by the final HTTPS response seen by the
browser; verify proxy behavior in staging.

## Deployment notes

- Start Uvicorn with `--no-server-header` to avoid advertising the server implementation.
- Terminate TLS only at infrastructure that preserves the validated Host value.
- Keep CORS and CSRF origin lists synchronized with the actual frontend origins.
- Do not add broad wildcard headers or origins to solve a failed preflight; add only the exact
  browser header required by a reviewed client change.
- Verify cookies, preflight, HSTS and security headers using the production hostname before rollout.
