import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Loader2, LockKeyhole, MessageCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { lolosPassingGrade } from "@/lib/analysis";
import { cleanFormationId } from "@/lib/formationSelection";
import type { SkdScoreWithFormation } from "@/lib/supabase/types";
import {
  createLeadAndSession,
  searchRationalizationTargets,
  type AnalysisGoal,
  type LeadFormInput,
  type RationalizationTargetOption,
} from "@/services/leadService";
import { getPublicFormationDetail, type PublicFormationDetail } from "@/services/formationService";
import { getCurrentAccount } from "@/services/authService";
import { getSkdScoreById } from "@/services/skdService";

export const Route = createFileRoute("/result/$scoreId")({
  validateSearch: (search: Record<string, unknown>) => ({
    targetFormationId: cleanFormationId(search.targetFormationId),
  }),
  head: () => ({
    meta: [
      { title: "Posisi Nilai SKD - AnalisaCPNS" },
      {
        name: "description",
        content: "Verifikasi nilai SKD dan siapkan target rasionalisasi melalui WhatsApp.",
      },
    ],
  }),
  component: ResultPage,
});

function ResultPage() {
  const { scoreId } = Route.useParams();
  const { targetFormationId } = Route.useSearch();
  const navigate = useNavigate();
  const returnTo = `/result/${scoreId}${targetFormationId ? `?targetFormationId=${targetFormationId}` : ""}`;
  const scoreQuery = useQuery({
    queryKey: ["skd-score", scoreId],
    queryFn: () => getSkdScoreById(scoreId),
  });
  const accountQuery = useQuery({
    queryKey: ["current-account"],
    queryFn: getCurrentAccount,
    staleTime: 60_000,
    retry: false,
  });
  const preferredTargetQuery = useQuery({
    queryKey: ["public-formation-detail", targetFormationId],
    queryFn: () => getPublicFormationDetail(targetFormationId!),
    enabled: Boolean(targetFormationId && accountQuery.data),
    staleTime: 60_000,
  });
  const [form, setForm] = useState<LeadFormInput>({
    target_instansi: "",
    target_formasi: "",
    target_formation_id: "",
    analysis_goal: "opportunity",
    preference_flags: [],
    consent_whatsapp: false,
  });
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<RationalizationTargetOption | null>(null);
  const [preferredTargetMessage, setPreferredTargetMessage] = useState<string | null>(null);
  const preferredTargetHandled = useRef(false);
  const deferredTargetSearch = useDeferredValue(targetSearch.trim());
  const targetQuery = useQuery({
    queryKey: ["rationalization-targets", scoreId, deferredTargetSearch],
    queryFn: () => searchRationalizationTargets(scoreId, deferredTargetSearch),
    enabled:
      Boolean(accountQuery.data) &&
      form.analysis_goal === "target" &&
      !selectedTarget &&
      deferredTargetSearch.length >= 2,
    staleTime: 30_000,
  });
  const createMutation = useMutation({
    mutationFn: () =>
      createLeadAndSession({
        score_id: scoreQuery.data!.id,
        lead: form,
      }),
    onSuccess: (result) => {
      toast.success("Kode analisis berhasil dibuat");
      navigate({ to: "/wa/$token", params: { token: result.token } });
    },
    onError: (error: Error) => {
      if (error.message === "AUTH_REQUIRED") {
        window.location.assign(`/login?next=${encodeURIComponent(returnTo)}`);
        return;
      }
      toast.error(`Kode belum berhasil dibuat: ${error.message}`);
    },
  });

  useEffect(() => {
    preferredTargetHandled.current = false;
    setPreferredTargetMessage(null);
  }, [targetFormationId]);

  useEffect(() => {
    if (!targetFormationId || preferredTargetHandled.current || !scoreQuery.data) {
      return;
    }

    if (preferredTargetQuery.isError) {
      preferredTargetHandled.current = true;
      setPreferredTargetMessage(
        "Target awal belum dapat diperiksa. Pilih target lain atau gunakan rekomendasi otomatis.",
      );
      return;
    }
    if (!preferredTargetQuery.isSuccess) return;

    preferredTargetHandled.current = true;
    if (!preferredTargetQuery.data) {
      setPreferredTargetMessage("Formasi target tidak ditemukan atau belum dipublikasikan.");
      return;
    }

    const target = buildTargetOption(scoreQuery.data, preferredTargetQuery.data);
    if (!target) {
      setPreferredTargetMessage(
        "Target awal tidak menerima pendidikan peserta atau bukan formasi UMUM. Pilih target lain atau gunakan rekomendasi otomatis.",
      );
      return;
    }

    setSelectedTarget(target);
    setTargetSearch(`${target.institution} - ${target.position}`);
    setForm((current) => ({
      ...current,
      analysis_goal: "target",
      target_formation_id: target.id,
      target_instansi: target.institution,
      target_formasi: target.position,
    }));
  }, [
    preferredTargetQuery.data,
    preferredTargetQuery.isError,
    preferredTargetQuery.isSuccess,
    scoreQuery.data,
    targetFormationId,
  ]);

  if (scoreQuery.isLoading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat data peserta
        </div>
      </PageShell>
    );
  }

  if (scoreQuery.isError || !scoreQuery.data) {
    return (
      <PageShell>
        <div className="mx-auto max-w-lg border-y border-red-200 bg-red-50 px-5 py-10 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 text-xl font-bold">Data tidak ditemukan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tautan tidak valid atau data ini sudah tidak tersedia.
          </p>
          <Link
            to="/search"
            className="mt-5 inline-flex text-sm font-bold text-primary hover:underline"
          >
            Kembali ke pencarian
          </Link>
        </div>
      </PageShell>
    );
  }

  const score = scoreQuery.data;
  const formation = score.skd_formations;
  const passed = lolosPassingGrade(score);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (createMutation.isPending) return;
    if (!form.consent_whatsapp) {
      toast.error("Setujui pengiriman hasil melalui WhatsApp terlebih dahulu.");
      return;
    }
    if (form.analysis_goal === "target" && !form.target_formation_id) {
      toast.error("Pilih instansi atau jabatan target terlebih dahulu.");
      return;
    }
    createMutation.mutate();
  }

  function chooseAnalysisGoal(goal: AnalysisGoal) {
    preferredTargetHandled.current = true;
    if (goal !== "target") clearTarget();
    setForm((current) => ({
      ...current,
      analysis_goal: goal,
    }));
  }

  function chooseTarget(target: RationalizationTargetOption) {
    setSelectedTarget(target);
    setTargetSearch(`${target.institution} - ${target.position}`);
    setForm((current) => ({
      ...current,
      analysis_goal: "target",
      target_formation_id: target.id,
      target_instansi: target.institution,
      target_formasi: target.position,
    }));
  }

  function clearTarget() {
    setSelectedTarget(null);
    setTargetSearch("");
    setPreferredTargetMessage(null);
    setForm((current) => ({
      ...current,
      target_formation_id: "",
      target_instansi: "",
      target_formasi: "",
    }));
  }

  return (
    <PageShell>
      <Link
        to="/search"
        search={{ targetFormationId }}
        className="mb-3 inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Kembali ke pencarian
      </Link>

      <section aria-labelledby="participant-title" className="border-y border-border py-3">
        <p className="text-xs font-semibold text-primary">Nilai SKD {score.tahun_skd ?? 2024}</p>
        <h1
          id="participant-title"
          className="mt-1 text-xl font-bold leading-tight [overflow-wrap:anywhere] sm:text-2xl"
        >
          {score.nama}
        </h1>
        <p className="mt-1 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere] sm:text-sm">
          {[formation?.jabatan, formation?.nama_instansi].filter(Boolean).join(" · ") ||
            "Formasi asal tidak tercatat"}
        </p>
        <dl className="my-3 grid grid-cols-4 divide-x divide-border bg-white text-center">
          {(
            [
              ["Total", score.total],
              ["TWK", score.twk],
              ["TIU", score.tiu],
              ["TKP", score.tkp],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="py-1.5">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd
                className={`font-mono text-lg font-bold ${label === "Total" ? "text-primary" : ""}`}
              >
                {value ?? "-"}
              </dd>
            </div>
          ))}
        </dl>
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer py-1 font-semibold text-primary">
            Lihat detail
          </summary>
          <dl className="mt-2 grid gap-2 [overflow-wrap:anywhere] sm:grid-cols-3">
            <div>
              <dt>Pendidikan</dt>
              <dd className="font-semibold text-foreground">
                {score.pendidikan ?? formation?.pendidikan ?? "-"}
              </dd>
            </div>
            <div>
              <dt>Halaman PDF</dt>
              <dd className="font-semibold text-foreground">{score.source_page ?? "-"}</dd>
            </div>
            <div>
              <dt>Ambang batas dasar</dt>
              <dd className="font-semibold text-foreground">
                {passed ? "Memenuhi" : "Belum memenuhi"}
              </dd>
            </div>
          </dl>
          <Link
            to="/simulasi-skd"
            search={{ targetFormationId, scoreId, sumber: "skd" }}
            className="inline-flex min-h-10 items-center font-semibold text-primary hover:underline"
          >
            Bandingkan nilai ini di web
          </Link>
        </details>
      </section>

      {accountQuery.isLoading ? (
        <p role="status" className="my-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Memeriksa akun...
        </p>
      ) : accountQuery.isError ? (
        <p className="my-4 text-sm text-muted-foreground" role="status">
          Akses akun belum bisa diperiksa.{" "}
          <button
            type="button"
            onClick={() => void accountQuery.refetch()}
            className="font-semibold text-primary hover:underline"
          >
            Coba lagi
          </button>
        </p>
      ) : accountQuery.data ? (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <fieldset disabled={createMutation.isPending}>
            <legend className="mb-2 text-sm font-bold">Apa yang ingin kamu cari?</legend>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/60 p-1">
              {(
                [
                  ["opportunity", "Rekomendasi formasi"],
                  ["related", "Jabatan sejenis"],
                  ["target", "Cek target saya"],
                ] as const
              ).map(([goal, label]) => (
                <label key={goal} className="min-w-0 cursor-pointer">
                  <input
                    type="radio"
                    name="analysis-goal"
                    value={goal}
                    checked={form.analysis_goal === goal}
                    onChange={() => chooseAnalysisGoal(goal)}
                    className="peer sr-only"
                  />
                  <span className="flex min-h-11 items-center justify-center rounded-md px-1 text-center text-xs font-semibold leading-tight text-muted-foreground peer-checked:bg-[#082b85] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1">
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {targetFormationId &&
            preferredTargetQuery.isLoading &&
            !preferredTargetHandled.current && (
              <p role="status" className="text-xs text-muted-foreground">
                Memeriksa target pilihan...
              </p>
            )}
          {preferredTargetMessage && (
            <p role="status" className="text-xs text-muted-foreground">
              {preferredTargetMessage}
            </p>
          )}
          {form.analysis_goal === "target" &&
            (selectedTarget ? (
              <div className="flex items-center justify-between gap-3 border-l-2 border-primary pl-3">
                <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
                  <strong>{selectedTarget.position}</strong>
                  <br />
                  <span className="text-xs text-muted-foreground">
                    {[selectedTarget.institution, selectedTarget.location]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={clearTarget}
                  disabled={createMutation.isPending}
                  className="min-h-11 shrink-0 text-sm font-semibold text-primary hover:underline"
                >
                  Ganti
                </button>
              </div>
            ) : (
              <div>
                <label className="relative block">
                  <span className="sr-only">Cari instansi atau jabatan</span>
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    value={targetSearch}
                    onChange={(event) => setTargetSearch(event.target.value)}
                    disabled={createMutation.isPending}
                    className="h-11 w-full rounded-lg border border-input bg-white pl-9 pr-3 text-sm"
                    placeholder="Cari instansi atau jabatan"
                    autoComplete="off"
                  />
                </label>
                {deferredTargetSearch.length >= 2 && (
                  <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-border bg-white">
                    {targetQuery.isFetching ? (
                      <p role="status" className="p-2 text-xs text-muted-foreground">
                        Mencari target...
                      </p>
                    ) : targetQuery.isError ? (
                      <p role="status" className="p-2 text-xs text-destructive">
                        Target belum dapat dimuat.{" "}
                        <button
                          type="button"
                          className="font-semibold underline"
                          onClick={() => void targetQuery.refetch()}
                        >
                          Coba lagi
                        </button>
                      </p>
                    ) : targetQuery.data?.length ? (
                      targetQuery.data.map((target) => (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => chooseTarget(target)}
                          className="block min-h-11 w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted"
                        >
                          <span className="block text-xs font-bold [overflow-wrap:anywhere]">
                            {target.position}
                          </span>
                          <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                            {[target.institution, target.location].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p role="status" className="p-2 text-xs text-muted-foreground">
                        Tidak ada target yang cocok.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}

          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={form.consent_whatsapp}
              disabled={createMutation.isPending}
              onChange={(event) => {
                const checked = event.target.checked;
                setForm((current) => ({ ...current, consent_whatsapp: checked }));
              }}
              className="size-4 shrink-0 accent-primary"
            />
            Kirim kartu hasil ke WhatsApp saya
          </label>
          <button
            type="submit"
            disabled={
              createMutation.isPending ||
              (form.analysis_goal === "target" && !selectedTarget) ||
              Boolean(
                targetFormationId &&
                preferredTargetQuery.isLoading &&
                !preferredTargetHandled.current,
              )
            }
            className="public-primary-button min-h-11 w-full disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <MessageCircle className="size-4" aria-hidden />
            )}
            {createMutation.isPending ? "Membuat kode..." : "Buat kode hasil WhatsApp"}
          </button>
        </form>
      ) : (
        <div className="mt-4">
          <Link
            to="/login"
            search={{ next: returnTo }}
            className="public-primary-button min-h-11 w-full"
          >
            <LockKeyhole className="size-4" aria-hidden /> Masuk untuk analisis
          </Link>
        </div>
      )}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Pembanding: hasil SKD 2024. Bukan prediksi kelulusan 2026.
      </p>
    </PageShell>
  );
}

function buildTargetOption(
  score: SkdScoreWithFormation,
  detail: PublicFormationDetail,
): RationalizationTargetOption | null {
  const participantEducation = canonicalEducation(score.pendidikan);
  const matchedEducation = (detail.pendidikan_options ?? []).find(
    (option) => canonicalEducation(option) === participantEducation,
  );
  const isEligible =
    detail.id !== score.formation_id &&
    detail.jenis_formasi?.trim().toUpperCase() === "UMUM" &&
    Boolean(participantEducation) &&
    Boolean(matchedEducation);
  if (!isEligible) return null;

  const cutoff = detail.stats.cutoff_total;
  return {
    id: detail.id,
    institution: detail.nama_instansi,
    position: detail.jabatan,
    location: detail.lokasi_formasi,
    formation_type: detail.jenis_formasi ?? "UMUM",
    education_requirement: detail.pendidikan,
    matched_education: matchedEducation ?? null,
    education_match:
      normalizeEducation(score.pendidikan) === normalizeEducation(matchedEducation)
        ? "exact"
        : "equivalent",
    quota: detail.stats.quota,
    attended: detail.stats.attended_count,
    competition_ratio: detail.stats.competition_ratio,
    cutoff_total: cutoff,
    score_gap: score.total != null && cutoff != null ? score.total - cutoff : null,
    above_historical_cutoff: isAtOrAboveCutoff(score, detail),
  };
}

function isAtOrAboveCutoff(score: SkdScoreWithFormation, detail: PublicFormationDetail): boolean {
  const participant = [score.total, score.tkp, score.tiu, score.twk];
  const cutoff = [
    detail.stats.cutoff_total,
    detail.stats.cutoff_tkp,
    detail.stats.cutoff_tiu,
    detail.stats.cutoff_twk,
  ];
  if (participant.some((value) => value == null) || cutoff.some((value) => value == null)) {
    return false;
  }
  for (let index = 0; index < participant.length; index += 1) {
    if (participant[index]! > cutoff[index]!) return true;
    if (participant[index]! < cutoff[index]!) return false;
  }
  return true;
}

function normalizeEducation(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
}

function canonicalEducation(value: string | null | undefined): string {
  const normalized = normalizeEducation(value);
  if (["S-1 HUKUM", "S1 HUKUM", "S-1 ILMU HUKUM", "S1 ILMU HUKUM"].includes(normalized)) {
    return "S-1 HUKUM";
  }
  return normalized;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[680px] px-4 pb-4 pt-2 sm:px-6 sm:pt-4">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
