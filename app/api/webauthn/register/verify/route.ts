import { NextResponse } from "next/server";
import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHALLENGE_MAX_AGE_MS, getOrigin, getRpID } from "@/lib/webauthn";

// Step 2 of registration: check the phone's signed response and save the
// new credential (its public key) for this employee.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: RegistrationResponseJSON;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Read AND delete the challenge in one step, so it can only ever be used
  // once, even if verification below fails or two requests race.
  const { data: stored } = await admin
    .from("webauthn_challenges")
    .delete()
    .eq("employee_id", user.id)
    .select("challenge, created_at")
    .maybeSingle();
  if (!stored) {
    return NextResponse.json(
      { error: "No registration in progress. Please try again." },
      { status: 400 }
    );
  }

  // created_at was set by the database; compare it with the server clock.
  const age = Date.now() - new Date(stored.created_at).getTime();
  if (age > CHALLENGE_MAX_AGE_MS) {
    return NextResponse.json(
      { error: "Registration timed out. Please try again." },
      { status: 400 }
    );
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: stored.challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpID(),
      requireUserVerification: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "Verification failed" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;

  const { error } = await admin.from("webauthn_credentials").insert({
    id: credential.id,
    employee_id: user.id,
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? null,
  });
  if (error) {
    return NextResponse.json({ error: "Could not save device" }, { status: 500 });
  }

  return NextResponse.json({ verified: true });
}
