import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHECKIN_CHALLENGE_MAX_AGE_MS, getRpID } from "@/lib/webauthn";

// Step 1 of check-in: the phone sends the location code it scanned, and we
// create a challenge for it to sign with Face ID / fingerprint.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let locationCode: unknown;
  try {
    ({ locationCode } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof locationCode !== "string" || locationCode.length === 0) {
    return NextResponse.json({ error: "Missing location code" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Any QR code can be scanned (menus, Wi-Fi, URLs...), so an unknown code
  // is normal. Real location codes are short; skip the lookup for long text.
  const { data: location } =
    locationCode.length <= 200
      ? await admin
          .from("locations")
          .select("id")
          .eq("qr_code", locationCode)
          .maybeSingle()
      : { data: null };
  if (!location) {
    return NextResponse.json(
      { error: "That's not a check-in code." },
      { status: 404 }
    );
  }

  // Only this employee's registered devices may answer the challenge.
  const { data: credentials } = await admin
    .from("webauthn_credentials")
    .select("id, transports")
    .eq("employee_id", user.id);
  if (!credentials || credentials.length === 0) {
    return NextResponse.json(
      { error: "Set up Face ID / fingerprint on this device first." },
      { status: 400 }
    );
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpID(),
    userVerification: "required",
    timeout: CHECKIN_CHALLENGE_MAX_AGE_MS,
    allowCredentials: credentials.map((c) => ({
      id: c.id,
      transports: c.transports ?? undefined,
    })),
  });

  // Replace any old challenge (delete + insert so created_at is a fresh
  // database now()). The location is stored HERE, on the server, so the
  // verify step never has to trust a location sent by the phone.
  await admin.from("webauthn_challenges").delete().eq("employee_id", user.id);
  const { error } = await admin.from("webauthn_challenges").insert({
    employee_id: user.id,
    challenge: options.challenge,
    location_id: location.id,
  });
  if (error) {
    return NextResponse.json({ error: "Could not save challenge" }, { status: 500 });
  }

  return NextResponse.json(options);
}
