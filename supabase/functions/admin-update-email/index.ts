import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .single();

    if (profileError || profile?.role !== "admin") {
      return json({ error: "Admin access required" }, 403);
    }

    const { action, userId, newEmail, newPassword } = await req.json();

    if (action === "listUsers") {
      const { data, error } = await adminClient.auth.admin.listUsers();
      if (error) {
        return json({ error: error.message }, 400);
      }
      await Promise.all(
        data.users
          .filter((user) => user.email)
          .map((user) => adminClient.from("profiles").update({ email: user.email }).eq("id", user.id))
      );
      return json({
        users: data.users.map((user) => ({
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
        })),
      });
    }

    if (!userId || (!newEmail && !newPassword)) {
      return json({ error: "Missing userId, newEmail, or newPassword" }, 400);
    }

    const updates: { email?: string; email_confirm?: boolean; password?: string } = {};
    if (newEmail) {
      updates.email = newEmail;
      updates.email_confirm = true;
    }
    if (newPassword) updates.password = newPassword;

    const { data, error } = await adminClient.auth.admin.updateUserById(userId, {
      ...updates,
    });

    if (error) {
      return json({ error: error.message }, 400);
    }

    if (data.user.email) {
      await adminClient.from("profiles").update({ email: data.user.email }).eq("id", data.user.id);
    }

    return json({ user: data.user });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
