import type { NextFunction, Request, Response } from "express";

/*
|--------------------------------------------------------------------------
| requireCustomHeaderForCookieAuth
|--------------------------------------------------------------------------
|
| The mobile/provider apps authenticate with a Bearer header, which a
| browser never attaches automatically — there's nothing for a malicious
| page to "ride along" on. The admin panel authenticates with an httpOnly
| cookie instead (see auth.controller.ts / setAuthCookie), and because
| that cookie has to be SameSite=None (the admin panel and this API live
| on different Render subdomains), the browser WILL attach it to
| cross-site requests automatically — including ones a malicious website
| tricks an already-logged-in admin's browser into sending (CSRF).
|
| The CORS origin allowlist in server.ts already blocks a forged
| *fetch/XHR* request from another origin (any request with a JSON body
| requires a CORS preflight, which is rejected for disallowed origins).
| What it does NOT block is a plain HTML <form> submission using one of
| the browser's CORS-"simple" content types
| (application/x-www-form-urlencoded, multipart/form-data, text/plain),
| since those never trigger a preflight — the browser just sends them,
| cookie included, and only blocks the attacker's page from reading the
| *response*. For any endpoint that mutates state based on the URL alone
| (no JSON body required), that's a real forged-request vector.
|
| The fix: require every cookie-authenticated, state-changing request to
| carry a custom header. Custom headers force a CORS preflight
| regardless of content type, and the existing origin allowlist already
| rejects preflights from any origin that isn't the real admin panel —
| so a bare HTML form from an attacker's site can never satisfy this
| check. Requests authenticated via a real Bearer header (mobile/
| provider apps, or anyone calling the API directly with a token) are
| exempt: there's no ambient-credential problem for them to begin with.
|--------------------------------------------------------------------------
*/

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_HEADER_NAME = "x-dwaar-sewa-client";
const CSRF_HEADER_VALUE = "admin-panel";

export function requireCustomHeaderForCookieAuth(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (SAFE_METHODS.has(request.method)) {
    return next();
  }

  const hasBearerToken = Boolean(
    request.headers.authorization?.toLowerCase().startsWith("bearer "),
  );

  // Bearer-authenticated requests (mobile/provider app) never rely on an
  // ambient cookie, so they're not susceptible to this attack — only
  // requests that could be authenticated by a cookie need the check.
  if (hasBearerToken) {
    return next();
  }

  const hasAdminCookie = Boolean(
    (request as Request & { cookies?: Record<string, string> }).cookies
      ?.adminToken,
  );

  // No cookie and no bearer token means there's no ambient credential
  // for a forged request to exploit — let auth.middleware reject it
  // with the normal 401 instead of a confusing CSRF-specific error.
  if (!hasAdminCookie) {
    return next();
  }

  if (request.headers[CSRF_HEADER_NAME] !== CSRF_HEADER_VALUE) {
    return response.status(403).json({
      message:
        "This request could not be verified as coming from the admin panel.",
    });
  }

  return next();
}

export const csrfHeaderName = CSRF_HEADER_NAME;
export const csrfHeaderValue = CSRF_HEADER_VALUE;
