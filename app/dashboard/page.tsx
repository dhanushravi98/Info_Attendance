import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DeviceSetup } from "./device-setup";
import { RecentCheckIns } from "./recent-check-ins";
import { CheckIn } from "./check-in";
import { SignOutButton } from "./sign-out-button";

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-10">
      <h1 className="mb-8 text-3xl font-semibold">Dashboard</h1>

      {/* Reading the session cookie happens per request, so with
          cacheComponents it must stream in behind a Suspense boundary. */}
      <Suspense fallback={<ProfileSkeleton />}>
        <Profile />
      </Suspense>

      <div className="mt-auto pt-10">
        <SignOutButton />
      </div>
    </main>
  );
}

async function Profile() {
  const supabase = await createClient();

  // getUser() checks the session with Supabase Auth, so it can be trusted.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: employee, error } = await supabase
    .from("employees")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !employee) {
    return (
      <p className="rounded-lg bg-amber-50 p-4 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
        Signed in as {user.email}, but no employee record was found.
      </p>
    );
  }

  // The admin client bypasses RLS, so filter by the verified user's id.
  const { count } = await createAdminClient()
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Signed in as</p>
        <p className="mt-1 text-2xl font-semibold">{employee.full_name}</p>
        <p className="mt-1 break-all text-zinc-600 dark:text-zinc-400">
          {employee.email}
        </p>
      </div>

      <DeviceSetup deviceCount={count ?? 0} />

      <CheckIn hasDevice={(count ?? 0) > 0} />

      <Suspense fallback={<HistorySkeleton />}>
        <RecentCheckIns userId={user.id} />
      </Suspense>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="h-[116px] animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
  );
}

function HistorySkeleton() {
  return (
    <div className="h-40 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
  );
}
