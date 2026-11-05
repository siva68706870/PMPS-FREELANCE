import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const accountIdSchema = z.object({ userId: z.string().uuid() });

export const getOwnerDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: owner, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "owner",
    });
    if (roleError || !owner) throw new Error("Owner access required.");

    const { data: profiles, error: profileError } = await context.supabase
      .from("profiles")
      .select("id, display_name, avatar_url, headline, location, skills, account_state, created_at");
    if (profileError) throw new Error("Could not load member profiles.");

    const { data: roles, error: rolesError } = await context.supabase
      .from("user_roles")
      .select("user_id, role");
    if (rolesError) throw new Error("Could not load member account types.");

    const usersById = new Map<string, { email?: string }>();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userPage, error: userError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (userError) throw new Error("Could not load member email addresses.");
    for (const user of userPage.users) usersById.set(user.id, { email: user.email });

    return (profiles ?? []).map((profile) => ({
      ...profile,
      role: roles?.find((item) => item.user_id === profile.id)?.role ?? "freelancer",
      email: usersById.get(profile.id)?.email ?? "",
    }));
  });

export const removeMarketplaceAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => accountIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: owner, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "owner",
    });
    if (roleError || !owner) throw new Error("Owner access required.");
    if (data.userId === context.userId) throw new Error("The owner account cannot be removed here.");

    const { data: role, error: targetError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (targetError) throw new Error("Could not verify the member account.");
    if (!role || role.role === "owner") throw new Error("This account cannot be removed here.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error("The member account could not be removed.");
    return { success: true };
  });