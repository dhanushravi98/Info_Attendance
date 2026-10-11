import "server-only";

// Shared WebAuthn settings for the API routes.

export const RP_NAME = "Attendance";

// A challenge must be used within this long after it was issued.
export const CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;

export function getRpID() {
  const rpID = process.env.WEBAUTHN_RP_ID;
  if (!rpID) throw new Error("Missing WEBAUTHN_RP_ID");
  return rpID;
}

export function getOrigin() {
  const origin = process.env.WEBAUTHN_ORIGIN;
  if (!origin) throw new Error("Missing WEBAUTHN_ORIGIN");
  return origin;
}
