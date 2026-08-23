import { createFileRoute } from "@tanstack/react-router";
import {
  clearUserSessionResponse,
  getAuthenticatedUser,
  validateAccountPassword,
  verifyAccountPassword,
  hashAccountPassword,
} from "@/lib/auth/server";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";

interface UpdateBody {
  marketing_opt_in?: boolean;
  current_password?: string;
  new_password?: string;
}

interface DeleteBody {
  password?: string;
}

export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);
        const auth = await getAuthenticatedUser(request, sb);
        if (!auth) return jsonResponse({ user: null });
        return jsonResponse({ user: auth.user });
      },
      PATCH: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as UpdateBody | null;
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);
        const auth = await getAuthenticatedUser(request, sb);
        if (!auth) return jsonResponse({ message: "Sesi login sudah berakhir." }, 401);

        const updates: Record<string, unknown> = {};
        if (typeof body?.marketing_opt_in === "boolean") {
          updates.marketing_opt_in = body.marketing_opt_in;
          if (body.marketing_opt_in) {
            updates.marketing_opt_in_at = new Date().toISOString();
            updates.marketing_opt_out_at = null;
          } else {
            updates.marketing_opt_out_at = new Date().toISOString();
          }
        }

        if (body?.new_password !== undefined) {
          const passwordError = validateAccountPassword(body.new_password);
          if (passwordError) return jsonResponse({ message: passwordError }, 400);
          if (typeof body.current_password !== "string") {
            return jsonResponse({ message: "Password saat ini wajib diisi." }, 400);
          }
          const { data: passwordRow } = await sb
            .from("app_users")
            .select("password_hash")
            .eq("id", auth.user.id)
            .single();
          if (
            !passwordRow ||
            !(await verifyAccountPassword(body.current_password, passwordRow.password_hash))
          ) {
            return jsonResponse({ message: "Password saat ini salah." }, 401);
          }
          updates.password_hash = await hashAccountPassword(body.new_password);
        }

        if (!Object.keys(updates).length) {
          return jsonResponse({ message: "Tidak ada perubahan akun." }, 400);
        }
        const { data: user, error } = await sb
          .from("app_users")
          .update(updates)
          .eq("id", auth.user.id)
          .select(
            "id,whatsapp,whatsapp_verified_at,marketing_opt_in,marketing_opt_in_at,created_at,last_login_at",
          )
          .single();
        if (error || !user) return jsonResponse({ message: "Akun belum dapat diperbarui." }, 500);
        return jsonResponse({ user });
      },
      DELETE: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as DeleteBody | null;
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) return jsonResponse({ message: `Supabase belum siap: ${configError}` }, 503);
        const auth = await getAuthenticatedUser(request, sb);
        if (!auth) return jsonResponse({ message: "Sesi login sudah berakhir." }, 401);
        if (typeof body?.password !== "string") {
          return jsonResponse({ message: "Password wajib diisi untuk menghapus akun." }, 400);
        }

        const { data: passwordRow } = await sb
          .from("app_users")
          .select("password_hash")
          .eq("id", auth.user.id)
          .single();
        if (
          !passwordRow ||
          !(await verifyAccountPassword(body.password, passwordRow.password_hash))
        ) {
          return jsonResponse({ message: "Password salah." }, 401);
        }
        const { error } = await sb.from("app_users").delete().eq("id", auth.user.id);
        if (error) return jsonResponse({ message: "Akun belum dapat dihapus." }, 500);
        return clearUserSessionResponse({ success: true });
      },
    },
  },
});
