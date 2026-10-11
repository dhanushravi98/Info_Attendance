import "server-only";
import { createClient } from "@supabase/supabase-js";

// Supabase client with the service_role key. It BYPASSES Row Level Security,
// so every query must filter by the signed-in user's id.
// `import "server-only"` makes the build fail if client code imports this.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
