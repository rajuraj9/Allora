// ============================================================
// lib/auth.ts
// JWT authentication middleware using Supabase Auth
// ============================================================

import { createClient } from "@supabase/supabase-js";

/**
 * Validates the Bearer JWT from the Authorization header using Supabase Auth.
 * Returns { user_id } on success, null on failure.
 */
export async function validateJWT(
  request: Request
): Promise<{ user_id: string } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  try {
    const client = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;

    return { user_id: data.user.id };
  } catch {
    return null;
  }
}
