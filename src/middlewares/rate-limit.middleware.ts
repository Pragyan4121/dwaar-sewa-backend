import {
  rateLimit,
  type RateLimitExceededEventHandler,
} from "express-rate-limit";

/*
|--------------------------------------------------------------------------
| Rate limiters
|--------------------------------------------------------------------------
|
| These throttle brute-force attempts (login guessing, OTP guessing/
| flooding, payment-endpoint abuse) by IP address. They intentionally key
| on IP only (not on the submitted phone/email), since keying on
| attacker-controlled input would let an attacker rotate identifiers to
| dodge the limiter, but a shared IP (NAT, office, campus) can still
| legitimately need more than a handful of attempts, so the ceilings below
| are generous rather than tight. Pair this with the per-account lockout
| in the admin login flow for real brute-force protection.
|--------------------------------------------------------------------------
*/

const jsonRateLimitHandler: RateLimitExceededEventHandler = (
  _request,
  response,
) => {
  response.status(429).json({
    message: "Too many requests. Please wait a while before trying again.",
  });
};

/*
 * Login endpoints (admin/customer/provider). Fairly strict since a
 * successful hit here is a full account takeover.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

/*
 * OTP request/verify endpoints (registration verification, password
 * reset). Slightly looser than login since legitimate users sometimes
 * need a couple of resends, but still bounded.
 */
export const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

/*
 * Payment initiate/verify endpoints. Generous enough for a customer
 * retrying a failed gateway redirect, but bounded to stop scripted abuse
 * of the eSewa/Khalti integration.
 */
export const paymentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

/*
 * A light, global backstop for every other route so a single client
 * can't hammer the API. Deliberately loose — this is not meant to
 * replace the route-specific limiters above.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});
