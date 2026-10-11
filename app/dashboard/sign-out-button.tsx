"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={loading}
      className="h-14 w-full rounded-xl border border-zinc-300 text-lg font-semibold transition-opacity disabled:opacity-50 dark:border-zinc-700"
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
