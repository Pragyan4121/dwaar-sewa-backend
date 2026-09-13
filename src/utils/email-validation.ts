import dns from "node:dns/promises";

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailFormat(email: string): boolean {
  return EMAIL_FORMAT_REGEX.test(email);
}

/**
 * Confirms the email's domain can actually receive mail by checking for
 * MX records. Falls back to an A record check since a small number of
 * domains accept mail directly on their A record with no MX entry.
 * This is what catches typos like "gmai.com" that look valid but aren't
 * real domains.
 */
async function domainCanReceiveEmail(email: string): Promise<boolean> {
  const domain = email.split("@")[1];

  if (!domain) {
    return false;
  }

  try {
    const mxRecords = await dns.resolveMx(domain);

    if (mxRecords.length > 0) {
      return true;
    }
  } catch {
    // No MX records found — fall through to the A record check below.
  }

  try {
    const addresses = await dns.resolve4(domain);

    return addresses.length > 0;
  } catch {
    return false;
  }
}

export async function validateEmailIsUsable(
  email: string,
): Promise<{ valid: true } | { valid: false; reason: string }> {
  if (!isValidEmailFormat(email)) {
    return {
      valid: false,
      reason: "Enter a valid email address",
    };
  }

  const canReceive = await domainCanReceiveEmail(email);

  if (!canReceive) {
    return {
      valid: false,
      reason: "This email domain doesn't exist or can't receive mail",
    };
  }

  return { valid: true };
}
