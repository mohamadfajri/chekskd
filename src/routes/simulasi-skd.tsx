import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle, Search } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { LoginGate } from "@/components/public/LoginGate";
import { SkdModeNav } from "@/components/public/SkdModeNav";
import { cleanFormationId } from "@/lib/formationSelection";
import {
  MANUAL_SKD_FIELDS,
  MANUAL_SKD_MAX,
  manualSkdScore,
  type ManualSkdAnalysis,
  type ManualSkdField,
  type ManualSkdResult,
  type ManualSkdTarget,
} from "@/lib/manualSkd";
import { getCurrentAccount } from "@/services/authService";
import { getFormationFilterOptions, getPublicFormationDetail } from "@/services/formationService";
import { getSkdScoreById } from "@/services/skdService";

export const Route = createFileRoute("/simulasi-skd")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { targetFormationId?: string; scoreId?: string; sumber?: "skd" } => ({
    targetFormationId: cleanFormationId(search.targetFormationId),
    scoreId: cleanFormationId(search.scoreId),
    sumber: search.sumber === "skd" ? "skd" : undefined,
  }),
  head: () => ({ meta: [{ title: "Bandingkan Nilai dengan SKD 2024 - AnalisaCPNS" }] }),
  component: ManualSkdPage,
});

const field =
  "h-11 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";
const point = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/manual-skd", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || "Analisis belum tersedia.");
  return data;
}

function ManualSkdPage() {
  const { targetFormationId, scoreId, sumber } = Route.useSearch();
  const fromSkd = sumber === "skd" || Boolean(scoreId);
  const account = useQuery({
    queryKey: ["current-account"],
    queryFn: getCurrentAccount,
    staleTime: 60_000,
    retry: false,
  });
  const saved = useQuery({
    queryKey: ["skd-score", scoreId],
    queryFn: () => getSkdScoreById(scoreId!),
    enabled: Boolean(scoreId && account.data),
  });
  const savedScore = saved.data?.tahun_skd === 2024 ? manualSkdScore({ ...saved.data }) : null;
  const next = new URLSearchParams();
  if (targetFormationId) next.set("targetFormationId", targetFormationId);
  if (scoreId) next.set("scoreId", scoreId);
  if (fromSkd) next.set("sumber", "skd");

  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="public-workspace skd-value-workspace">
        <SkdModeNav mode={fromSkd ? "skd" : "tryout"} targetFormationId={targetFormationId} />
        {account.isPending ? (
          <p role="status">Memeriksa akses...</p>
        ) : account.isError ? (
          <button type="button" className={button} onClick={() => void account.refetch()}>
            Coba lagi
          </button>
        ) : !account.data ? (
          <LoginGate
            next={next.size ? `/simulasi-skd?${next}` : "/simulasi-skd"}
            title={
              fromSkd
                ? "Masuk untuk membandingkan nilai SKD"
                : "Masuk untuk menganalisis skor tryout"
            }
          />
        ) : scoreId && saved.isPending ? (
          <p role="status">Memuat nilai SKD 2024...</p>
        ) : (
          <>
            {scoreId && !savedScore && (
              <p className="mb-3 text-sm text-muted-foreground" role="status">
                Nilai dari data peserta belum dapat dimuat. Masukkan nilai SKD 2024 secara manual.
              </p>
            )}
            <ManualSkdForm
              key={`${fromSkd}:${scoreId ?? ""}:${targetFormationId ?? ""}`}
              initialTargetId={targetFormationId}
              fromSkd={fromSkd}
              initialScore={savedScore}
              initialEducation={savedScore ? (saved.data?.pendidikan ?? "") : ""}
              sourceFormationId={savedScore ? saved.data?.formation_id : undefined}
            />
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function ManualSkdForm({
  initialTargetId,
  fromSkd,
  initialScore,
  initialEducation,
  sourceFormationId,
}: {
  initialTargetId?: string;
  fromSkd: boolean;
  initialScore: ReturnType<typeof manualSkdScore>;
  initialEducation: string;
  sourceFormationId?: string;
}) {
  const [values, setValues] = useState<Record<ManualSkdField, string>>({
    twk: initialScore ? String(initialScore.twk) : "",
    tiu: initialScore ? String(initialScore.tiu) : "",
    tkp: initialScore ? String(initialScore.tkp) : "",
  });
  const [education, setEducation] = useState(initialEducation);
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState(initialTargetId ?? "");
  const [targetOpen, setTargetOpen] = useState(Boolean(initialTargetId));
  const score = manualSkdScore(
    Object.fromEntries(
      MANUAL_SKD_FIELDS.map((key) => [key, values[key] === "" ? null : Number(values[key])]),
    ),
  );
  const filters = useQuery({
    queryKey: ["formation-filter-options"],
    queryFn: getFormationFilterOptions,
    staleTime: 30 * 60_000,
  });
  const initialTarget = useQuery({
    queryKey: ["public-formation-detail", initialTargetId],
    queryFn: () => getPublicFormationDetail(initialTargetId!),
    enabled: Boolean(initialTargetId),
  });
  const targets = useMutation({
    mutationFn: (input: { education: string; query: string }) =>
      request<{ targets: ManualSkdTarget[] }>({ action: "targets", ...input }),
  });
  const analysis = useMutation({
    mutationFn: (input: {
      education: string;
      targetId?: string;
      twk: number;
      tiu: number;
      tkp: number;
    }) => request<ManualSkdAnalysis>({ action: "analyze", ...input, sourceFormationId }),
  });
  const busy = targets.isPending || analysis.isPending;
  const submittedTarget = analysis.variables?.targetId;
  const targetLabel = initialTarget.data
    ? `${initialTarget.data.jabatan} · ${initialTarget.data.nama_instansi}`
    : "Target dari daftar formasi";

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (score && education.trim() && !busy) {
            analysis.mutate({
              education: education.trim(),
              targetId: targetId || undefined,
              ...score,
            });
          }
        }}
        className="space-y-5 border-y border-border py-5"
      >
        <h2 className="text-lg font-bold">
          {fromSkd
            ? initialScore
              ? "Nilai SKD 2024 dari data peserta"
              : "Masukkan nilai SKD 2024"
            : "Masukkan skor tryout"}
        </h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-4">
          {MANUAL_SKD_FIELDS.map((key) => (
            <label key={key} className="grid min-w-0 gap-1 text-sm font-semibold">
              {key.toUpperCase()}
              <input
                type="number"
                min={0}
                max={MANUAL_SKD_MAX[key]}
                step={1}
                required
                disabled={busy}
                readOnly={Boolean(initialScore)}
                inputMode="numeric"
                className={field}
                value={values[key]}
                onChange={(event) => {
                  setValues({ ...values, [key]: event.target.value });
                  analysis.reset();
                }}
              />
            </label>
          ))}
          <div className="grid gap-1 text-sm font-semibold">
            <label htmlFor="manual-total">Total</label>
            <output
              id="manual-total"
              className="flex h-10 items-center text-xl tabular-nums text-primary"
            >
              {score?.total ?? "-"}
            </output>
          </div>
        </div>
        <label className="grid max-w-md gap-1 text-sm font-semibold">
          Pendidikan
          <input
            list="manual-education"
            className={field}
            value={education}
            required
            maxLength={160}
            disabled={busy}
            onChange={(event) => {
              setEducation(event.target.value);
              setTargetId(initialTargetId && targetId === initialTargetId ? initialTargetId : "");
              targets.reset();
              analysis.reset();
            }}
            placeholder="Contoh: S-1 Hukum"
          />
        </label>
        <datalist id="manual-education">
          {filters.data?.education_options.map((option) => (
            <option key={option.value} value={option.value} />
          ))}
        </datalist>

        <div>
          <button
            type="button"
            disabled={busy}
            aria-expanded={targetOpen}
            aria-controls="manual-target"
            className="min-h-10 text-sm font-semibold text-primary hover:underline"
            onClick={() => {
              setTargetOpen(!targetOpen);
              if (targetOpen) {
                setTargetId("");
                targets.reset();
                analysis.reset();
              }
            }}
          >
            {targetOpen ? "Analisis tanpa target" : "Tambah target formasi (opsional)"}
          </button>
          {targetOpen && (
            <div id="manual-target" className="mt-2 space-y-3">
              {targetId && targetId === initialTargetId ? (
                <p className="text-sm font-medium [overflow-wrap:anywhere]">{targetLabel}</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="grid min-w-0 flex-1 basis-52 gap-1 text-sm font-semibold">
                      Instansi atau jabatan incaran
                      <input
                        className={field}
                        value={query}
                        disabled={busy}
                        maxLength={120}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setTargetId("");
                          targets.reset();
                          analysis.reset();
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input px-3 text-sm font-semibold text-primary disabled:opacity-50"
                      disabled={!education.trim() || !query.trim() || busy}
                      onClick={() =>
                        targets.mutate({ education: education.trim(), query: query.trim() })
                      }
                    >
                      {targets.isPending ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Search className="size-4" aria-hidden />
                      )}
                      Cari target
                    </button>
                  </div>
                  {targets.isError && (
                    <p className="text-sm text-destructive" role="alert">
                      {targets.error.message}
                    </p>
                  )}
                  {targets.data &&
                    (targets.data.targets.length ? (
                      <label className="grid gap-1 text-sm font-semibold">
                        Pilih formasi incaran
                        <select
                          className={field}
                          value={targetId}
                          disabled={busy}
                          onChange={(event) => {
                            setTargetId(event.target.value);
                            analysis.reset();
                          }}
                        >
                          <option value="">Tanpa target</option>
                          {targets.data.targets.map((target) => (
                            <option key={target.id} value={target.id}>
                              {[target.job, target.institution, target.location]
                                .filter(Boolean)
                                .join(" · ")}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <p className="text-sm text-muted-foreground" role="status">
                        Belum ada pembanding SKD 2024 yang sesuai untuk pencarian ini.{" "}
                        <Link
                          to="/formasi"
                          search={{ tampilan: "katalog" }}
                          className="font-semibold text-primary hover:underline"
                        >
                          Lihat katalog formasi
                        </Link>
                      </p>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
        <button className={button} disabled={!score || !education.trim() || busy}>
          {analysis.isPending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="size-4" aria-hidden />
          )}
          {analysis.isPending
            ? "Membandingkan..."
            : targetId
              ? "Analisis target dan alternatif"
              : "Lihat rekomendasi formasi"}
        </button>
      </form>
      {analysis.isError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {analysis.error.message}
        </p>
      )}
      {analysis.data && (
        <section className="mt-6" aria-live="polite" aria-labelledby="manual-result-title">
          <h2 id="manual-result-title" className="text-lg font-bold">
            Hasil perbandingan SKD 2024
          </h2>
          {analysis.data.targetUnavailable && (
            <p className="mt-2 text-sm text-muted-foreground">
              Belum ada pembanding SKD 2024 yang sesuai untuk target ini. Cek alternatif di bawah
              bila tersedia.
            </p>
          )}
          {analysis.data.results.length ? (
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {analysis.data.results.map((result) => (
                <li key={result.target.id}>
                  <ManualResult
                    result={result}
                    fromSkd={fromSkd}
                    isTarget={result.target.id === submittedTarget}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 border-y border-border py-4 text-sm">
              <p>Belum ada pembanding SKD 2024 yang sesuai dengan pendidikan ini.</p>
              <Link
                to="/formasi"
                search={{ tampilan: "katalog" }}
                className="mt-2 inline-block font-semibold text-primary hover:underline"
              >
                Lihat katalog formasi
              </Link>
            </div>
          )}
          {analysis.data.results.length > 0 && (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Rekomendasi berasal dari formasi umum dengan data SKD 2024 yang memadai, diurutkan
              menurut skor terakhir lanjut SKB terendah, lalu kuota terbesar.{" "}
              {fromSkd
                ? "Perbandingan ini tidak memastikan nilai lama dapat digunakan pada 2026."
                : "Skor tryout bukan nilai resmi dan bukan prediksi kelulusan."}
            </p>
          )}
        </section>
      )}
    </>
  );
}

function ManualResult({
  result,
  fromSkd,
  isTarget,
}: {
  result: ManualSkdResult;
  fromSkd: boolean;
  isTarget: boolean;
}) {
  const { target, score, average, scoreGap, rank, ties, belowThreshold } = result;
  const gap = average == null ? null : Math.round((score.total - average) * 10) / 10;
  return (
    <article className="py-4">
      <p className="text-xs font-semibold text-primary">
        {isTarget ? "Target pilihanmu" : "Rekomendasi historis"}
      </p>
      <h3 className="mt-1 font-bold [overflow-wrap:anywhere]">{target.job}</h3>
      <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {[target.institution, target.location, target.matchedEducation].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-3 text-sm font-bold">
        {gap == null
          ? "Rata-rata historis belum tersedia."
          : gap === 0
            ? "Setara dengan rata-rata peserta 2024."
            : `${point.format(Math.abs(gap))} poin di ${gap > 0 ? "atas" : "bawah"} rata-rata peserta 2024.`}
      </p>
      <dl className="my-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [fromSkd ? "Nilai SKD 2024 kamu" : "Skor tryout kamu", score.total],
            ["Rata-rata peserta 2024", average == null ? "-" : point.format(average)],
            ["Skor terakhir lanjut SKB", target.cutoff],
            ["Posisi simulasi*", rank ?? "-"],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        {scoreGap < 0
          ? `Selisih ${Math.abs(scoreGap)} poin ke skor terakhir lanjut SKB.`
          : scoreGap === 0
            ? "Total sama dengan skor terakhir lanjut SKB; urutan subtes bisa membedakan posisi."
            : `${scoreGap} poin di atas skor terakhir lanjut SKB.`}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {rank == null
          ? `*Posisi tidak dihitung: ${belowThreshold.join(", ").toUpperCase()} belum mencapai ambang formasi umum 2024.`
          : `*Dibandingkan dengan peserta yang memenuhi ambang batas historis${ties ? `, dengan ${ties} peserta berskor identik` : ""}.`}
      </p>
    </article>
  );
}
