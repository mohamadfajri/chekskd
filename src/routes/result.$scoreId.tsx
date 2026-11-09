import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Crosshair,
  Gauge,
  Loader2,
  MessageCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { LoginGate } from "@/components/public/LoginGate";
import { SkdCoverageNote } from "@/components/public/SkdCoverageNote";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { getZona, lolosPassingGrade, zonaLabel } from "@/lib/analysis";
import { cleanFormationId } from "@/lib/formationSelection";
import type { SkdScoreWithFormation } from "@/lib/supabase/types";
import {
  createLeadAndSession,
  searchRationalizationTargets,
  type AnalysisGoal,
  type LeadFormInput,
  type PreferenceFlag,
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
    nama_panggilan: "",
    target_tahun: "2026",
    rencana: "Belum yakin",
    target_instansi: "",
    target_formasi: "",
    target_formation_id: "",
    analysis_goal: "opportunity",
    preference_flags: [],
    consent_whatsapp: false,
    consent_marketing: false,
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
        window.location.assign(`/login?next=${encodeURIComponent(`/result/${scoreId}`)}`);
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
  const zone = getZona(score.total);
  const passed = lolosPassingGrade(score);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
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
    if (goal !== "target") clearTarget();
    setForm((current) => ({
      ...current,
      analysis_goal: goal,
      preference_flags: goal === "target" ? [] : current.preference_flags,
    }));
  }

  function togglePreference(preference: PreferenceFlag) {
    setForm((current) => {
      const selected = current.preference_flags.includes(preference);
      if (selected) {
        return {
          ...current,
          preference_flags: current.preference_flags.filter((item) => item !== preference),
        };
      }
      if (current.preference_flags.length >= 2) {
        toast.info("Pilih maksimal dua prioritas agar rekomendasi tidak terlalu sempit.");
        return current;
      }
      return { ...current, preference_flags: [...current.preference_flags, preference] };
    });
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
        className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Kembali ke hasil pencarian
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_410px] lg:items-start">
        <div>
          <section aria-labelledby="participant-title">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase text-primary">
                  Data peserta terpilih
                </p>
                <h1 id="participant-title" className="mt-2 text-2xl font-extrabold sm:text-3xl">
                  {score.nama}
                </h1>
              </div>
              <span className="rounded-sm bg-muted px-2 py-1 font-mono text-[10px] font-semibold text-muted-foreground">
                SKD {score.tahun_skd ?? 2024}
              </span>
            </div>

            <div className="grid gap-5 border-b border-border py-5 sm:grid-cols-2">
              <Detail label="Instansi" value={formation?.nama_instansi ?? "-"} />
              <Detail label="Formasi" value={formation?.jabatan ?? "-"} />
              <Detail label="Pendidikan" value={score.pendidikan ?? formation?.pendidikan ?? "-"} />
              <Detail
                label="Sumber"
                value={`Pengumuman halaman ${score.source_page ?? "-"}`}
                mono
              />
            </div>

            <div className="grid grid-cols-2 overflow-hidden border-b border-border sm:grid-cols-4">
              <ScoreCell label="TWK" value={score.twk} threshold={65} />
              <ScoreCell label="TIU" value={score.tiu} threshold={80} bordered />
              <ScoreCell label="TKP" value={score.tkp} threshold={166} bordered />
              <ScoreCell label="Total" value={score.total} highlight bordered />
            </div>

            <div className="grid border-b border-border sm:grid-cols-2">
              <StatusBlock
                label="Ambang batas dasar"
                value={passed ? "Memenuhi" : "Belum memenuhi"}
                tone={passed ? "success" : "risk"}
              />
              <StatusBlock
                label="Indikator nilai awal"
                value={zonaLabel(zone)}
                tone={zone === "aman" ? "success" : zone === "waspada" ? "warning" : "risk"}
                bordered
              />
            </div>

            <div className="mt-6 border-l-2 border-primary bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
              Memenuhi ambang batas belum berarti posisi akhir aman. Mesin akan membaca skor ini
              bersama kuota, peserta hadir, batas historis, pendidikan, dan kualitas data formasi.
            </div>
          </section>

          <section className="mt-10 border-t border-border pt-7" aria-labelledby="reading-title">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-primary">
                <BarChart3 className="h-4 w-4" />
              </span>
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase text-muted-foreground">
                  Langkah berikutnya
                </p>
                <h2 id="reading-title" className="mt-0.5 text-lg font-bold">
                  Tentukan cara nilai ini dibandingkan
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
              Pilih apakah mesin perlu mencari peluang historis terbesar, menjaga bidang pekerjaan
              tetap sejenis, atau membedah satu target yang sudah Anda incar.
            </p>
            <SkdCoverageNote className="mt-3 max-w-2xl" />
          </section>
        </div>

        {accountQuery.isLoading ? (
          <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memeriksa akun
          </div>
        ) : accountQuery.data ? (
          <form
            onSubmit={onSubmit}
            className="overflow-hidden rounded-lg border border-border bg-white shadow-lg shadow-[#071b36]/5 lg:sticky lg:top-20"
          >
            <div className="border-b border-border bg-primary px-5 py-5 text-white">
              <p className="font-mono text-[9px] font-semibold uppercase text-white/70">
                Siapkan rasionalisasi
              </p>
              <h2 className="mt-1 text-lg font-bold">Pilih tujuan analisis</h2>
              <p className="mt-1 text-xs leading-5 text-white/75">
                Hasil lengkap dikirim sebagai satu gambar melalui WhatsApp.
              </p>
            </div>

            <div className="space-y-6 p-5">
              <FormSection icon={UserRound} number="01" title="Tujuan Anda">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <InputField label="Nama panggilan" required>
                    <input
                      value={form.nama_panggilan}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, nama_panggilan: event.target.value }))
                      }
                      className="result-input"
                      placeholder="Nama untuk hasil"
                      required
                    />
                  </InputField>
                  <InputField label="Target seleksi" required>
                    <select
                      value={form.target_tahun}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          target_tahun: event.target.value as LeadFormInput["target_tahun"],
                        }))
                      }
                      className="result-input"
                    >
                      <option value="2026">2026</option>
                      <option value="2027">2027</option>
                      <option value="Belum tahu">Belum tahu</option>
                    </select>
                  </InputField>
                </div>
                <InputField label="Rencana saat ini" required>
                  <select
                    value={form.rencana}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        rencana: event.target.value as LeadFormInput["rencana"],
                      }))
                    }
                    className="result-input"
                  >
                    <option value="Pakai nilai lama">Pakai nilai lama</option>
                    <option value="Tes ulang">Tes ulang</option>
                    <option value="Belum yakin">Belum yakin</option>
                  </select>
                </InputField>
              </FormSection>

              <FormSection icon={BarChart3} number="02" title="Tujuan analisis">
                <div className="space-y-2" role="radiogroup" aria-label="Tujuan analisis">
                  <GoalButton
                    icon={Trophy}
                    active={form.analysis_goal === "opportunity"}
                    title="Peluang terbesar"
                    description="Cari posisi historis terbaik dari seluruh formasi yang sesuai."
                    onClick={() => chooseAnalysisGoal("opportunity")}
                  />
                  <GoalButton
                    icon={BriefcaseBusiness}
                    active={form.analysis_goal === "related"}
                    title="Bidang sejenis"
                    description="Utamakan jabatan yang masih satu rumpun pekerjaan."
                    onClick={() => chooseAnalysisGoal("related")}
                  />
                  <GoalButton
                    icon={Crosshair}
                    active={form.analysis_goal === "target"}
                    title="Analisis target saya"
                    description="Bedah satu instansi atau jabatan yang sudah Anda incar."
                    onClick={() => chooseAnalysisGoal("target")}
                  />
                </div>
              </FormSection>

              {form.analysis_goal === "target" ? (
                <FormSection icon={Target} number="03" title="Target pilihan">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <input
                      value={targetSearch}
                      onChange={(event) => {
                        if (selectedTarget) clearTarget();
                        setTargetSearch(event.target.value);
                      }}
                      className="result-input pl-9 pr-9"
                      placeholder="Cari instansi atau jabatan"
                      autoComplete="off"
                    />
                    {targetQuery.isFetching ? (
                      <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
                    ) : targetSearch ? (
                      <button
                        type="button"
                        onClick={clearTarget}
                        title="Hapus target"
                        aria-label="Hapus target"
                        className="absolute right-2 top-1.5 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}

                    {!selectedTarget && deferredTargetSearch.length >= 2 && (
                      <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-xl">
                        {targetQuery.isError ? (
                          <p className="p-3 text-xs text-destructive">Target belum dapat dimuat.</p>
                        ) : targetQuery.data?.length ? (
                          targetQuery.data.map((target) => (
                            <button
                              key={target.id}
                              type="button"
                              onClick={() => chooseTarget(target)}
                              className="block w-full border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-muted"
                            >
                              <span className="block text-xs font-bold">{target.position}</span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                {target.institution}
                              </span>
                              <span className="mt-1 block font-mono text-[9px] text-muted-foreground">
                                Kuota {target.quota} · hadir {target.attended} · batas{" "}
                                {target.cutoff_total ?? "-"}
                              </span>
                            </button>
                          ))
                        ) : !targetQuery.isFetching ? (
                          <p className="p-3 text-xs text-muted-foreground">
                            Tidak ada target yang cocok dengan pencarian ini.
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {selectedTarget ? (
                    <TargetPreview target={selectedTarget} />
                  ) : (
                    <>
                      {targetFormationId && preferredTargetQuery.isLoading ? (
                        <p className="mt-2 flex items-center gap-2 text-[11px] leading-5 text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memeriksa kecocokan
                          target
                        </p>
                      ) : null}
                      {preferredTargetMessage ? (
                        <div className="mt-3 flex gap-2 border-l-2 border-[#a45e00] bg-[#fff8eb] p-3 text-[11px] leading-5 text-[#7a4b08]">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <p>{preferredTargetMessage}</p>
                        </div>
                      ) : null}
                      {!preferredTargetMessage ? (
                        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                          Mesin akan membedah target ini dan menambahkan dua alternatif yang lebih
                          rasional.
                        </p>
                      ) : null}
                    </>
                  )}
                </FormSection>
              ) : (
                <FormSection icon={SlidersHorizontal} number="03" title="Prioritas tambahan">
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Prioritas tambahan"
                  >
                    <PreferenceChip
                      icon={Gauge}
                      selected={form.preference_flags.includes("low_competition")}
                      label="Persaingan rendah"
                      onClick={() => togglePreference("low_competition")}
                    />
                    <PreferenceChip
                      icon={Trophy}
                      selected={form.preference_flags.includes("large_quota")}
                      label="Kuota lebih besar"
                      onClick={() => togglePreference("large_quota")}
                    />
                    <PreferenceChip
                      icon={ShieldCheck}
                      selected={form.preference_flags.includes("strong_data")}
                      label="Data paling kuat"
                      onClick={() => togglePreference("strong_data")}
                    />
                  </div>
                  <p className="text-[10px] leading-5 text-muted-foreground">
                    Opsional, maksimal dua. Hasil tetap berisi pilihan pengaman, seimbang, dan
                    ambisius.
                  </p>
                </FormSection>
              )}

              <div className="space-y-3 border-t border-border pt-5">
                <ConsentRow
                  checked={form.consent_whatsapp}
                  onChange={(checked) =>
                    setForm((current) => ({ ...current, consent_whatsapp: checked }))
                  }
                  required
                >
                  Kirim kartu hasil analisis melalui WhatsApp.
                </ConsentRow>
                <ConsentRow
                  checked={form.consent_marketing}
                  onChange={(checked) =>
                    setForm((current) => ({ ...current, consent_marketing: checked }))
                  }
                >
                  Saya bersedia menerima informasi CPNS dan tryout. Pilihan ini tidak wajib.
                </ConsentRow>
              </div>
            </div>

            <div className="border-t border-border bg-muted px-5 py-4">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="public-primary-button h-12 w-full disabled:opacity-50"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle className="h-4 w-4" />
                )}
                Buat kode analisis
              </button>
            </div>
          </form>
        ) : (
          <div className="lg:sticky lg:top-20">
            <LoginGate
              next={`/result/${scoreId}`}
              title="Masuk untuk merasionalisasi nilai"
              description="Nilai peserta tetap dapat diperiksa tanpa akun. Login diperlukan saat mesin membandingkan formasi dan membuat kode RSKD."
            />
          </div>
        )}
      </div>

      <style>{`
        .result-input { width:100%; height:40px; border-radius:8px; border:1px solid var(--color-input); background:#fff; padding:0 12px; font-size:12px; color:var(--color-foreground); transition:border-color .15s, box-shadow .15s; }
        .result-input:focus { border-color:var(--color-primary); box-shadow:0 0 0 3px #dce8ff; outline:none; }
      `}</style>
    </PageShell>
  );
}

function TargetPreview({ target }: { target: RationalizationTargetOption }) {
  const gapLabel =
    target.score_gap == null
      ? "-"
      : target.score_gap >= 0
        ? `+${target.score_gap}`
        : String(target.score_gap);
  return (
    <div className="mt-3 overflow-hidden border-l-2 border-[#16805c] bg-[#eef9f5] text-xs text-[#116347]">
      <div className="flex gap-2 p-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-bold">Target diprioritaskan</p>
          <p className="mt-1 leading-5">{target.position}</p>
          <p className="leading-5 opacity-80">{target.institution}</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-px bg-[#cfe9df]">
        <TargetMetric label="Kuota" value={formatCompactNumber(target.quota)} />
        <TargetMetric label="Hadir" value={formatCompactNumber(target.attended)} />
        <TargetMetric
          label="Rasio"
          value={
            target.competition_ratio == null
              ? "-"
              : `${formatCompactNumber(target.competition_ratio)}x`
          }
        />
        <TargetMetric label="Selisih" value={gapLabel} />
      </div>
    </div>
  );
}

function TargetMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-[#f7fcfa] px-2 py-2.5 text-center">
      <p className="text-[8px] font-semibold uppercase opacity-70">{label}</p>
      <p className="mt-1 truncate font-mono text-[11px] font-bold">{value}</p>
    </div>
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

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value);
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold leading-6 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function ScoreCell({
  label,
  value,
  threshold,
  highlight = false,
  bordered = false,
}: {
  label: string;
  value: number | null;
  threshold?: number;
  highlight?: boolean;
  bordered?: boolean;
}) {
  return (
    <div className={`${bordered ? "border-l border-border" : ""} px-3 py-4 text-center sm:py-5`}>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold ${highlight ? "text-primary" : ""}`}>
        {value ?? "-"}
      </p>
      {threshold ? (
        <p className="mt-1 font-mono text-[9px] text-muted-foreground">PG {threshold}</p>
      ) : null}
    </div>
  );
}

function StatusBlock({
  label,
  value,
  tone,
  bordered = false,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "risk";
  bordered?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "text-[#16805c]"
      : tone === "warning"
        ? "text-[#a45e00]"
        : "text-[#b43b45]";
  return (
    <div
      className={`${bordered ? "border-t border-border sm:border-l sm:border-t-0" : ""} px-4 py-4`}
    >
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function FormSection({
  icon: Icon,
  number,
  title,
  children,
}: {
  icon: typeof UserRound;
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="mb-3 flex w-full items-center gap-2 text-xs font-bold">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-muted text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="font-mono text-[9px] text-[#8ca0b7]">{number}</span>
        {title}
      </legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function InputField({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
        {label} {required ? <span className="text-destructive">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function GoalButton({
  icon: Icon,
  active,
  title,
  description,
  onClick,
}: {
  icon: typeof Trophy;
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex min-h-[72px] w-full items-start gap-3 rounded-md border p-3 text-left transition ${
        active
          ? "border-primary bg-[#f3f7ff] text-foreground shadow-sm shadow-[#1058f5]/10"
          : "border-border bg-white text-muted-foreground hover:border-[#a8c3ff] hover:text-foreground"
      }`}
    >
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${
          active ? "bg-primary text-white" : "bg-muted text-primary"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2 text-[11px] font-bold">
          {title}
          {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
        </span>
        <span className="mt-1 block text-[9px] leading-4 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function PreferenceChip({
  icon: Icon,
  selected,
  label,
  onClick,
}: {
  icon: typeof Gauge;
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[10px] font-semibold transition ${
        selected
          ? "border-primary bg-[#f3f7ff] text-primary"
          : "border-border bg-white text-muted-foreground hover:border-[#a8c3ff] hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {selected ? <Check className="h-3.5 w-3.5" /> : null}
    </button>
  );
}

function ConsentRow({
  checked,
  onChange,
  required = false,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-5 text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        required={required}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#2f6bff]"
      />
      <span>{children}</span>
    </label>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
