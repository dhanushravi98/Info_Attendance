import { NextResponse } from "next/server";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CHECKIN_CHALLENGE_MAX_AGE_MS,
  DUPLICATE_CHECKIN_WINDOW_MS,
  getOrigin,
  getRpID,
} from "@/lib/webauthn";

// Step 2 of check-in: verify the Face ID / fingerprint signature, and only
// then write the attendance record. Every failure path returns BEFORE the
// insert at the bottom.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: AuthenticationResponseJSON;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body?.id !== "string") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Read AND delete the challenge in one step, so it can only ever be used
  // once, even if verification below fails or two requests race.
  const { data: stored } = await admin
    .from("webauthn_challenges")
    .delete()
    .eq("employee_id", user.id)
    .select("challenge, created_at, location_id")
    .maybeSingle();
  // A challenge without a location came from device setup, not check-in.
  if (!stored || !stored.location_id) {
    return NextResponse.json(
      { error: "No check-in in progress. Please try again." },
      { status: 400 }
    );
  }

  // created_at was set by the database; compare it with the server clock.
  const age = Date.now() - new Date(stored.created_at).getTime();
  if (age > CHECKIN_CHALLENGE_MAX_AGE_MS) {
    return NextResponse.json(
      { error: "Check-in timed out. Please try again." },
      { status: 400 }
    );
  }

  // Scoped to this employee, so nobody can sign with someone else's device.
  const { data: credential } = await admin
    .from("webauthn_credentials")
    .select("id, public_key, counter, transports")
    .eq("id", body.id)
    .eq("employee_id", user.id)
    .maybeSingle();
  if (!credential) {
    return NextResponse.json(
      { error: "This device isn't registered for your account." },
      { status: 400 }
    );
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: stored.challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpID(),
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: isoBase64URL.toBuffer(credential.public_key),
        // Apple and Google passkeys usually report a counter of 0 every time.
        // SimpleWebAuthn only rejects a counter that fails to increase when
        // one of the two values is non-zero, so 0 -> 0 passes correctly.
        counter: Number(credential.counter),
        transports: credential.transports ?? undefined,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "Verification failed" }, { status: 400 });
  }

  const { error: counterError } = await admin
    .from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq("id", credential.id)
    .eq("employee_id", user.id);
  if (counterError) {
    return NextResponse.json({ error: "Could not update device" }, { status: 500 });
  }

  // For the success message on the phone. The id came from the challenge row.
  const { data: location } = await admin
    .from("locations")
    .select("name")
    .eq("id", stored.location_id)
    .maybeSingle();
  const locationName = location?.name ?? "the office";

  // Ignore a repeat scan at the same spot within a couple of minutes.
  // (Server clock, never the phone's.)
  const since = new Date(Date.now() - DUPLICATE_CHECKIN_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from("attendance_events")
    .select("created_at")
    .eq("employee_id", user.id)
    .eq("location_id", stored.location_id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) {
    return NextResponse.json({
      alreadyCheckedIn: true,
      createdAt: recent.created_at,
      locationName,
      message: "You're already checked in here. No need to scan again.",
    });
  }

  // The location comes from the challenge row, never the request body.
  // created_at is left out so the database's now() stamps it.
  const { data: event, error } = await admin
    .from("attendance_events")
    .insert({ employee_id: user.id, location_id: stored.location_id })
    .select("created_at")
    .single();
  if (error) {
    return NextResponse.json({ error: "Could not save check-in" }, { status: 500 });
  }

  return NextResponse.json({
    checkedIn: true,
    createdAt: event.created_at,
    locationName,
  });
}
