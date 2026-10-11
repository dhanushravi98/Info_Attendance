import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RP_NAME, getRpID } from "@/lib/webauthn";

// Step 1 of registration: create a challenge for the phone to sign.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: employee } = await admin
    .from("employees")
    .select("id, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  if (!employee) {
    return NextResponse.json({ error: "No employee record" }, { status: 403 });
  }

  // Tell the phone which credentials it already has, so it won't create a duplicate.
  const { data: existing } = await admin
    .from("webauthn_credentials")
    .select("id, transports")
    .eq("employee_id", employee.id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpID(),
    userName: employee.email,
    userDisplayName: employee.full_name,
    userID: new TextEncoder().encode(employee.id),
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.id,
      transports: c.transports ?? undefined,
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform", // built-in Face ID / fingerprint only
      userVerification: "required",
      residentKey: "preferred",
    },
  });

  // One challenge per employee. Replace any old one with delete + insert
  // (rather than an update) so created_at gets a fresh database now().
  await admin.from("webauthn_challenges").delete().eq("employee_id", employee.id);
  const { error } = await admin
    .from("webauthn_challenges")
    .insert({ employee_id: employee.id, challenge: options.challenge });
  if (error) {
    return NextResponse.json({ error: "Could not save challenge" }, { status: 500 });
  }

  return NextResponse.json(options);
}
