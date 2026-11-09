import { createFileRoute } from "@tanstack/react-router";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { catalogText } from "@/lib/formationCatalog";
import { cleanFormationId } from "@/lib/formationSelection";
import { manualSkdScore } from "@/lib/manualSkd";
import { getServerSupabase, jsonResponse } from "@/lib/supabase/server";
import { getSkdComparisonCoverage } from "@/server/formationCatalog";
import { getManualSkdTargets, simulateManualSkd } from "@/server/manualSkd";
import { useSumopodSkdReads as readsSkdFromSumopod } from "@/server/skdPreview";

export const Route = createFileRoute("/api/manual-skd")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { client: sb } = getServerSupabase();
        if (!sb) return jsonResponse({ message: "Cakupan simulasi belum tersedia." }, 503);
        try {
          return jsonResponse(await getSkdComparisonCoverage(sb, readsSkdFromSumopod(request)));
        } catch {
          return jsonResponse({ message: "Cakupan simulasi belum tersedia." }, 503);
        }
      },
      POST: async ({ request }: { request: Request }) => {
        const { client: sb } = getServerSupabase();
        if (!sb) return jsonResponse({ message: "Simulasi belum tersedia." }, 503);
        const auth = await getAuthenticatedUser(request, sb);
        if (!auth) return jsonResponse({ message: "Masuk untuk menjalankan simulasi." }, 401);

        const input = await request.json().catch(() => null);
        const education = catalogText(input?.education, 160);
        if (!education || !["targets", "simulate"].includes(input?.action)) {
          return jsonResponse({ message: "Pendidikan dan jenis permintaan wajib diisi." }, 400);
        }
        try {
          const fromSumopod = readsSkdFromSumopod(request);
          if (input.action === "targets") {
            const targets = await getManualSkdTargets(
              sb,
              {
                education,
                query: catalogText(input.query),
                targetId: cleanFormationId(input.targetId),
              },
              fromSumopod,
            );
            return jsonResponse({ targets });
          }
          const score = manualSkdScore(input);
          const targetId = cleanFormationId(input.targetId);
          if (!score || !targetId) {
            return jsonResponse(
              { message: "Periksa nilai TWK, TIU, TKP, dan formasi target." },
              400,
            );
          }
          const [target] = await getManualSkdTargets(sb, { education, targetId }, fromSumopod);
          if (!target) {
            return jsonResponse(
              { message: "Target belum memiliki data SKD yang sesuai untuk simulasi ini." },
              422,
            );
          }
          return jsonResponse({ result: await simulateManualSkd(sb, target, score, fromSumopod) });
        } catch {
          return jsonResponse({ message: "Simulasi belum dapat dimuat. Coba lagi." }, 503);
        }
      },
    },
  },
});
