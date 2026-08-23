import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

type MatchKind = "exact" | "equivalent" | "family_only";
type ReviewStatus = "pending" | "approved" | "rejected";

interface AliasInput {
  normalized_label?: string;
  canonical_label?: string;
  degree_level?: string | null;
  major_family?: string;
  match_kind?: MatchKind;
  review_status?: ReviewStatus;
  notes?: string | null;
}

function normalize(value: unknown, maxLength = 160): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ").toUpperCase();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

export const Route = createFileRoute("/api/admin/education-aliases")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const { data, error } = await sb
          .from("skd_education_aliases")
          .select(
            "normalized_label, canonical_label, degree_level, major_family, match_kind, review_status, notes, created_at",
          )
          .order("major_family", { ascending: true })
          .order("canonical_label", { ascending: true })
          .order("normalized_label", { ascending: true });
        if (error) return jsonResponse({ message: error.message }, 500);
        return jsonResponse({ aliases: data ?? [] });
      },

      POST: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;

        const body = (await request.json().catch(() => null)) as AliasInput | null;
        const normalizedLabel = normalize(body?.normalized_label);
        const canonicalLabel = normalize(body?.canonical_label);
        const degreeLevel = normalize(body?.degree_level, 30);
        const majorFamily = normalize(body?.major_family, 80);
        const matchKind = body?.match_kind;
        const reviewStatus = body?.review_status;
        const notes =
          typeof body?.notes === "string" ? body.notes.trim().slice(0, 500) || null : null;

        if (
          !normalizedLabel ||
          !canonicalLabel ||
          !majorFamily ||
          !matchKind ||
          !["exact", "equivalent", "family_only"].includes(matchKind) ||
          !reviewStatus ||
          !["pending", "approved", "rejected"].includes(reviewStatus)
        ) {
          return jsonResponse(
            { message: "Data alias pendidikan belum lengkap atau tidak valid." },
            400,
          );
        }
        if (matchKind !== "family_only" && !degreeLevel) {
          return jsonResponse({ message: "Jenjang wajib untuk kecocokan exact/equivalent." }, 400);
        }

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb) {
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);
        }

        const { data, error } = await sb
          .from("skd_education_aliases")
          .upsert(
            {
              normalized_label: normalizedLabel,
              canonical_label: canonicalLabel,
              degree_level: degreeLevel,
              major_family: majorFamily,
              match_kind: matchKind,
              review_status: reviewStatus,
              notes,
            },
            { onConflict: "normalized_label" },
          )
          .select("*")
          .single();
        if (error) return jsonResponse({ message: error.message }, 500);
        return jsonResponse({ alias: data });
      },
    },
  },
});
