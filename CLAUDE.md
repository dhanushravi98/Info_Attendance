# Attendance System

@AGENTS.md

## What we're building
A mobile-responsive web app (not a native app) where employees check in
to the office by scanning a static printed QR code, then confirming with
Face ID / fingerprint.

## Flow (V1)
1. Employee logs in once; the session persists in their phone browser.
2. Employee registers their device's biometric (WebAuthn) one time.
3. To check in, they tap "Check in" -> the in-page camera opens -> they
   scan the static QR code on the wall (it encodes a fixed location ID).
4. After a successful scan, the server issues a challenge, the phone
   signs it with Face ID/fingerprint, and the server verifies it.
5. Only then does the server write the attendance record.

## Stack
- Next.js (App Router, TypeScript, Tailwind)
- Supabase (Postgres + Auth)
- SimpleWebAuthn for biometrics
- qr-scanner for in-browser QR reading
- Hosted on Vercel (HTTPS is required for camera and WebAuthn)

## Hard rules
- The server timestamp is the only trusted time. Never use a time sent
  by the phone. Use the database's now().
- The check-in endpoint must reject any request without a verified
  WebAuthn assertion.
- The Supabase service_role key is server-only: never prefix it with
  NEXT_PUBLIC_ and never import it in client code.
- No location/GPS tracking. Do not request geolocation.
- Never commit .env.local.

## How to work
- Build one small step at a time and explain what changed.
- Prefer simple, readable code over clever abstractions.
- After each step, tell me how to test it on a real phone.