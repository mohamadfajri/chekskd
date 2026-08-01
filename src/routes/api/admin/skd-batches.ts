import { createFileRoute } from "@tanstack/react-router";
import { getServerSupabase, jsonResponse, requireAdmin } from "@/lib/supabase/server";

type CsvValue = string | undefined;

interface ImportRow {
  tahun?: string;
  nama_instansi?: string;
  kode_instansi?: string;
  jabatan?: string;
  kode_jabatan?: string;
  kode_lokasi?: string;
  lokasi_formasi?: string;
  kode_jenis_formasi?: string;
  jenis_formasi?: string;
  pendidikan_formasi?: string;
  pendidikan?: string;
  pendidikan_raw?: string;
  jumlah_formasi?: string;
  no_peserta?: string;
  nama?: string;
  nama_raw?: string;
  nama_normalized?: string;
  tahun_nilai_skd?: string;
  twk?: string;
  tiu?: string;
  tkp?: string;
  total?: string;
  keterangan?: string;
  source_page?: string;
  source_page_formasi?: string;
  formation_instance_id?: string;
  formation_quality_status?: string;
  quality_status?: string;
  parser_confidence?: string;
  validation_errors?: string;
}

interface BatchBody {
  adminPassword?: string;
  action?: "validate" | "create" | "import_formations" | "import_scores" | "finalize";
  batchId?: string;
  sourceId?: string;
  batch?: {
    slug?: string;
    institutionCode?: string;
    institutionName?: string;
    selectionYear?: number;
    parserFamily?: string;
    parserVersion?: string;
    sourcePageCount?: number;
  };
  source?: {
    sheetRow?: number;
    fileName?: string;
    driveFileId?: string;
    sourceUrl?: string;
    totalPages?: number;
    documentType?: "skd" | "integration" | "unknown";
    hasTextLayer?: boolean;
  };
  rows?: ImportRow[];
}

const QUALITY_STATUSES = new Set([
  "parsed",
  "auto_corrected",
  "needs_review",
  "verified",
  "rejected",
]);

function toInt(value: CsvValue): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) ? parsed : null;
}

function toConfidence(value: CsvValue): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function clean(value: CsvValue): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function qualityStatus(value: CsvValue): string {
  const normalized = value?.trim().toLowerCase() || "parsed";
  return QUALITY_STATUSES.has(normalized) ? normalized : "needs_review";
}

function validateFormationRow(row: ImportRow, index: number): string[] {
  const errors: string[] = [];
  const label = `baris ${index + 1}`;
  if (!clean(row.formation_instance_id)) errors.push(`${label}: formation_instance_id kosong`);
  if (!clean(row.nama_instansi)) errors.push(`${label}: nama_instansi kosong`);
  if (!clean(row.jabatan)) errors.push(`${label}: jabatan kosong`);
  if (toInt(row.tahun) == null) errors.push(`${label}: tahun tidak valid`);
  const quota = toInt(row.jumlah_formasi);
  if (quota == null || quota < 0) errors.push(`${label}: jumlah_formasi tidak valid`);
  return errors;
}

function validateScoreRow(row: ImportRow, index: number): string[] {
  const errors = validateFormationRow(row, index);
  const label = `baris ${index + 1}`;
  const noPeserta = clean(row.no_peserta);
  const status = clean(row.keterangan)?.toUpperCase() ?? "";
  const scores = [toInt(row.twk), toInt(row.tiu), toInt(row.tkp), toInt(row.total)];

  if (!noPeserta || !/^\d{15,20}$/.test(noPeserta)) {
    errors.push(`${label}: no_peserta tidak valid`);
  }
  if (!clean(row.nama)) errors.push(`${label}: nama kosong`);
  if (!/^(P\/L(?:-[A-Z0-9]+)?|P|TL|TH|TMS|DIS)$/.test(status)) {
    errors.push(`${label}: keterangan tidak valid`);
  }

  if (["TH", "TMS", "DIS"].includes(status)) {
    if (scores.some((value) => value != null)) {
      errors.push(`${label}: peserta ${status} harus memiliki nilai kosong`);
    }
  } else if (scores.some((value) => value == null)) {
    errors.push(`${label}: nilai tidak lengkap`);
  } else if (scores[0]! + scores[1]! + scores[2]! !== scores[3]) {
    errors.push(`${label}: total nilai tidak konsisten`);
  }

  return errors;
}

export const Route = createFileRoute("/api/admin/skd-batches")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const authError = requireAdmin(request);
        if (authError) return authError;
        const { client: sb, error: configError } = getServerSupabase();
        if (!sb)
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);

        const { data, error } = await sb
          .from("skd_batches")
          .select(
            "id, slug, institution_code, institution_name, selection_year, parser_family, parser_version, status, source_count, source_page_count, formation_count, participant_count, review_issue_count, created_at, updated_at",
          )
          .order("created_at", { ascending: false });
        if (error) return jsonResponse({ message: error.message }, 500);
        return jsonResponse({ batches: data ?? [] });
      },

      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json().catch(() => null)) as BatchBody | null;
        if (!body) return jsonResponse({ message: "Body JSON tidak valid." }, 400);
        const authError = requireAdmin(request, body);
        if (authError) return authError;
        if (body.action === "validate") return jsonResponse({ valid: true });

        const { client: sb, error: configError } = getServerSupabase();
        if (!sb)
          return jsonResponse({ message: `Supabase server belum siap: ${configError}` }, 503);

        if (body.action === "create") {
          const batch = body.batch;
          const source = body.source;
          if (
            !batch?.slug ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(batch.slug) ||
            !batch.institutionName?.trim() ||
            !batch.selectionYear ||
            !batch.parserFamily?.trim() ||
            !batch.parserVersion?.trim() ||
            !source?.fileName?.trim() ||
            !source.sourceUrl?.trim()
          ) {
            return jsonResponse({ message: "Metadata batch atau sumber belum lengkap." }, 400);
          }
          if (!/^3(?:\.|$)/.test(batch.parserVersion.trim())) {
            return jsonResponse(
              { message: "Hanya output parser versi 3 yang boleh distaging." },
              400,
            );
          }

          const { data: existing } = await sb
            .from("skd_batches")
            .select("id")
            .eq("slug", batch.slug)
            .maybeSingle();
          if (existing) return jsonResponse({ message: `Batch ${batch.slug} sudah ada.` }, 409);

          const { data: createdBatch, error: batchError } = await sb
            .from("skd_batches")
            .insert({
              slug: batch.slug,
              institution_code: batch.institutionCode?.trim() || null,
              institution_name: batch.institutionName.trim(),
              selection_year: batch.selectionYear,
              parser_family: batch.parserFamily.trim(),
              parser_version: batch.parserVersion.trim(),
              status: "importing",
              source_count: 1,
              source_page_count: batch.sourcePageCount ?? source.totalPages ?? 0,
            })
            .select("id")
            .single();
          if (batchError) return jsonResponse({ message: batchError.message }, 500);

          const { data: createdSource, error: sourceError } = await sb
            .from("skd_sources")
            .insert({
              batch_id: createdBatch.id,
              sheet_row: source.sheetRow ?? null,
              file_name: source.fileName.trim(),
              drive_file_id: source.driveFileId?.trim() || null,
              source_url: source.sourceUrl.trim(),
              total_pages: source.totalPages ?? null,
              document_type: source.documentType ?? "skd",
              has_text_layer: source.hasTextLayer ?? null,
            })
            .select("id")
            .single();
          if (sourceError) {
            await sb.from("skd_batches").delete().eq("id", createdBatch.id);
            return jsonResponse({ message: sourceError.message }, 500);
          }

          return jsonResponse({ batchId: createdBatch.id, sourceId: createdSource.id }, 201);
        }

        if (!body.batchId || !body.sourceId) {
          return jsonResponse({ message: "batchId dan sourceId wajib diisi." }, 400);
        }
        if (!Array.isArray(body.rows) && body.action !== "finalize") {
          return jsonResponse({ message: "rows wajib berupa array." }, 400);
        }
        if ((body.rows?.length ?? 0) > 500) {
          return jsonResponse({ message: "Maksimal 500 baris per request." }, 400);
        }

        if (body.action === "import_formations") {
          const rows = body.rows ?? [];
          const errors = rows.flatMap(validateFormationRow);
          if (errors.length) return jsonResponse({ message: errors.slice(0, 20).join("; ") }, 400);

          const payload = rows.map((row) => ({
            batch_id: body.batchId,
            source_id: body.sourceId,
            formation_key: clean(row.formation_instance_id),
            tahun: toInt(row.tahun),
            kode_instansi: clean(row.kode_instansi),
            nama_instansi: clean(row.nama_instansi),
            kode_jabatan: clean(row.kode_jabatan),
            jabatan: clean(row.jabatan),
            kode_lokasi: clean(row.kode_lokasi),
            lokasi_formasi: clean(row.lokasi_formasi),
            kode_jenis_formasi: clean(row.kode_jenis_formasi),
            jenis_formasi: clean(row.jenis_formasi),
            pendidikan: clean(row.pendidikan_formasi),
            pendidikan_options: (clean(row.pendidikan_formasi) ?? "")
              .split(/\s+\/\s+/)
              .map((item) => item.trim())
              .filter(Boolean),
            jumlah_formasi: toInt(row.jumlah_formasi) ?? 0,
            page_number: toInt(row.source_page_formasi),
            quality_status: qualityStatus(row.formation_quality_status),
            parser_confidence: toConfidence(row.parser_confidence),
            raw_payload: row,
          }));
          const { data, error } = await sb
            .from("skd_formations")
            .upsert(payload, { onConflict: "batch_id,formation_key" })
            .select("id, formation_key, quality_status");
          if (error) return jsonResponse({ message: error.message }, 500);

          const issuePayload = (data ?? [])
            .filter((row) => row.quality_status === "needs_review")
            .map((row) => {
              const sourceRow = rows.find(
                (item) => clean(item.formation_instance_id) === row.formation_key,
              );
              return {
                batch_id: body.batchId,
                formation_id: row.id,
                field_name: "formation",
                issue_code: "parser_review_required",
                severity: "error",
                raw_value: sourceRow?.validation_errors ?? null,
                confidence: toConfidence(sourceRow?.parser_confidence),
              };
            });
          if (issuePayload.length) {
            const { error: issueError } = await sb.from("skd_review_issues").insert(issuePayload);
            if (issueError) return jsonResponse({ message: issueError.message }, 500);
          }

          return jsonResponse({
            formationsUpserted: data?.length ?? 0,
            issuesCreated: issuePayload.length,
          });
        }

        if (body.action === "import_scores") {
          const rows = body.rows ?? [];
          const errors = rows.flatMap(validateScoreRow);
          if (errors.length) return jsonResponse({ message: errors.slice(0, 20).join("; ") }, 400);

          const formationKeys = [
            ...new Set(rows.map((row) => clean(row.formation_instance_id))),
          ].filter(Boolean) as string[];
          const { data: formations, error: formationError } = await sb
            .from("skd_formations")
            .select("id, formation_key")
            .eq("batch_id", body.batchId)
            .in("formation_key", formationKeys);
          if (formationError) return jsonResponse({ message: formationError.message }, 500);
          const formationIds = new Map(
            (formations ?? []).map((row) => [row.formation_key as string, row.id as string]),
          );
          if (formationIds.size !== formationKeys.length) {
            return jsonResponse({ message: "Ada formasi peserta yang belum distaging." }, 409);
          }

          const payload = rows.map((row) => ({
            batch_id: body.batchId,
            source_id: body.sourceId,
            formation_id: formationIds.get(clean(row.formation_instance_id)!)!,
            no_peserta: clean(row.no_peserta),
            nama: clean(row.nama),
            nama_raw: clean(row.nama_raw) ?? clean(row.nama),
            nama_normalized: clean(row.nama_normalized) ?? clean(row.nama)?.toLowerCase(),
            pendidikan: clean(row.pendidikan),
            pendidikan_raw: clean(row.pendidikan_raw) ?? clean(row.pendidikan),
            tahun_skd: toInt(row.tahun_nilai_skd),
            twk: toInt(row.twk),
            tiu: toInt(row.tiu),
            tkp: toInt(row.tkp),
            total: toInt(row.total),
            keterangan: clean(row.keterangan)?.toUpperCase(),
            source_page: toInt(row.source_page),
            quality_status: qualityStatus(row.quality_status),
            parser_confidence: toConfidence(row.parser_confidence),
            raw_payload: row,
          }));
          const { data, error } = await sb
            .from("skd_scores")
            .upsert(payload, { onConflict: "batch_id,no_peserta" })
            .select("id, no_peserta, quality_status");
          if (error) return jsonResponse({ message: error.message }, 500);

          const issuePayload = (data ?? [])
            .filter((row) => row.quality_status === "needs_review")
            .map((row) => {
              const sourceRow = rows.find((item) => clean(item.no_peserta) === row.no_peserta);
              return {
                batch_id: body.batchId,
                score_id: row.id,
                field_name: "row",
                issue_code: "parser_review_required",
                severity: "error",
                raw_value: sourceRow?.validation_errors ?? null,
                confidence: toConfidence(sourceRow?.parser_confidence),
              };
            });
          if (issuePayload.length) {
            const { error: issueError } = await sb.from("skd_review_issues").insert(issuePayload);
            if (issueError) return jsonResponse({ message: issueError.message }, 500);
          }

          return jsonResponse({
            scoresUpserted: data?.length ?? 0,
            issuesCreated: issuePayload.length,
          });
        }

        if (body.action === "finalize") {
          const [formations, scores, issues] = await Promise.all([
            sb
              .from("skd_formations")
              .select("id", { count: "exact", head: true })
              .eq("batch_id", body.batchId),
            sb
              .from("skd_scores")
              .select("id", { count: "exact", head: true })
              .eq("batch_id", body.batchId),
            sb
              .from("skd_review_issues")
              .select("id", { count: "exact", head: true })
              .eq("batch_id", body.batchId)
              .eq("status", "open"),
          ]);
          const firstError = formations.error ?? scores.error ?? issues.error;
          if (firstError) return jsonResponse({ message: firstError.message }, 500);

          const { error } = await sb
            .from("skd_batches")
            .update({
              status: "review",
              formation_count: formations.count ?? 0,
              participant_count: scores.count ?? 0,
              review_issue_count: issues.count ?? 0,
            })
            .eq("id", body.batchId)
            .eq("status", "importing");
          if (error) return jsonResponse({ message: error.message }, 500);
          return jsonResponse({
            formationCount: formations.count ?? 0,
            participantCount: scores.count ?? 0,
            reviewIssueCount: issues.count ?? 0,
          });
        }

        return jsonResponse({ message: "Action tidak dikenal." }, 400);
      },
    },
  },
});
