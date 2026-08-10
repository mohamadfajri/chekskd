import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Image,
  MessageCircle,
  Search,
  X,
} from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import { getSkdScoreById } from "@/services/skdService";
import {
  createLeadAndSession,
  searchRationalizationTargets,
  type LeadFormInput,
  type RationalizationTargetOption,
} from "@/services/leadService";
import { getZona, lolosPassingGrade, zonaLabel, zonaColor } from "@/lib/analysis";
import { toast } from "sonner";

export const Route = createFileRoute("/result/$scoreId")({
  head: () => ({
    meta: [
      { title: "Preview Nilai SKD — cpnsguru.id" },
      {
        name: "description",
        content: "Preview nilai SKD dan form untuk menerima analisa lengkap via WhatsApp.",
      },
    ],
  }),
  component: ResultPage,
});

function ResultPage() {
  const { scoreId } = Route.useParams();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ["skd-score", scoreId],
    queryFn: () => getSkdScoreById(scoreId),
  });

  const [form, setForm] = useState<LeadFormInput>({
    nama_panggilan: "",
    target_tahun: "2026",
    rencana: "Belum yakin",
    target_instansi: "",
    target_formasi: "",
    target_formation_id: "",
    consent_whatsapp: false,
    consent_marketing: false,
  });
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<RationalizationTargetOption | null>(null);
  const deferredTargetSearch = useDeferredValue(targetSearch.trim());

  const targetQuery = useQuery({
    queryKey: ["rationalization-targets", scoreId, deferredTargetSearch],
    queryFn: () => searchRationalizationTargets(scoreId, deferredTargetSearch),
    enabled: !selectedTarget && deferredTargetSearch.length >= 2,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const s = query.data!;
      return createLeadAndSession({
        score_id: s.id,
        lead: form,
      });
    },
    onSuccess: (res) => {
      toast.success("Kode hasil berhasil dibuat!");
      navigate({ to: "/wa/$token", params: { token: res.token } });
    },
    onError: (err: Error) => {
      toast.error("Gagal menyimpan data: " + err.message);
    },
  });

  if (query.isLoading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat data...
        </div>
      </PageShell>
    );
  }

  if (query.isError || !query.data) {
    return (
      <PageShell>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <p className="mt-2 font-semibold">Data tidak ditemukan</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Data mungkin sudah dihapus atau tautan tidak valid.
          </p>
          <Link
            to="/search"
            className="mt-4 inline-block text-sm font-semibold text-primary hover:underline"
          >
            Kembali ke pencarian
          </Link>
        </div>
      </PageShell>
    );
  }

  const s = query.data;
  const f = s.skd_formations;
  const zona = getZona(s.total);
  const lolos = lolosPassingGrade(s);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.consent_whatsapp) {
      toast.error("Silakan centang persetujuan WhatsApp.");
      return;
    }
    if (!form.target_formation_id || !selectedTarget) {
      toast.error("Pilih satu target formasi dari hasil pencarian.");
      return;
    }
    mutation.mutate();
  }

  function chooseTarget(target: RationalizationTargetOption) {
    setSelectedTarget(target);
    setTargetSearch(`${target.institution} - ${target.position}`);
    setForm({
      ...form,
      target_formation_id: target.id,
      target_instansi: target.institution,
      target_formasi: target.position,
    });
  }

  function clearTarget() {
    setSelectedTarget(null);
    setTargetSearch("");
    setForm({ ...form, target_formation_id: "", target_instansi: "", target_formasi: "" });
  }

  return (
    <PageShell>
      <Link
        to="/search"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Kembali ke pencarian
      </Link>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Preview */}
        <div className="lg:col-span-3">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Preview Nilai
            </p>
            <h1 className="mt-1 text-2xl font-bold">{s.nama}</h1>
            <div className="mt-4 grid gap-y-1.5 text-sm sm:grid-cols-2">
              <Info label="Instansi" value={f?.nama_instansi ?? "-"} />
              <Info label="Formasi" value={f?.jabatan ?? "-"} />
              <Info label="Tahun SKD" value={s.tahun_skd?.toString() ?? "-"} />
              <Info label="Pendidikan" value={s.pendidikan ?? f?.pendidikan ?? "-"} />
              <Info label="Halaman PDF" value={s.source_page?.toString() ?? "-"} />
            </div>

            <div className="mt-6 grid grid-cols-4 gap-2 text-center">
              {[
                { l: "TWK", v: s.twk, pg: 65 },
                { l: "TIU", v: s.tiu, pg: 80 },
                { l: "TKP", v: s.tkp, pg: 166 },
                { l: "Total", v: s.total, hi: true },
              ].map((c) => (
                <div key={c.l} className={`rounded-xl p-3 ${c.hi ? "bg-brand-soft" : "bg-muted"}`}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {c.l}
                  </div>
                  <div
                    className={`mt-0.5 text-2xl font-bold ${c.hi ? "text-primary" : "text-foreground"}`}
                  >
                    {c.v ?? "-"}
                  </div>
                  {c.pg && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">PG {c.pg}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div
                className={`rounded-xl border p-4 text-sm ${lolos ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}
              >
                <div className="text-xs font-semibold uppercase tracking-wider opacity-80">
                  Passing Grade
                </div>
                <div className="mt-1 text-base font-bold">
                  {lolos ? "Lolos PG" : "Belum Lolos PG"}
                </div>
              </div>
              <div className={`rounded-xl border p-4 text-sm ${zonaColor(zona)}`}>
                <div className="text-xs font-semibold uppercase tracking-wider opacity-80">
                  Zona Nilai
                </div>
                <div className="mt-1 text-base font-bold">{zonaLabel(zona)}</div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              Nilai kamu sudah melewati (atau berada di sekitar) ambang batas, tetapi persaingan
              CPNS tidak hanya berdasarkan passing grade. Untuk formasi populer, ranking dan jumlah
              pesaing sangat menentukan.
            </div>
          </div>
        </div>

        {/* Lead form */}
        <div className="lg:col-span-2">
          <form
            onSubmit={onSubmit}
            className="sticky top-20 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Hasil via WhatsApp
            </p>
            <h2 className="mt-1 text-lg font-bold">Terima kartu analisis di WhatsApp</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Isi target singkat. Nomor WhatsApp akan dikenali saat kamu mengirim kode ke Hermes.
            </p>

            <div className="mt-4 flex items-center gap-3 rounded-lg border border-[#cfe2f2] bg-[#eef6fc] p-3 text-xs text-[#245e88]">
              <Image className="h-5 w-5 shrink-0" />
              <span>
                Hermes akan membalas satu gambar ringkasan yang siap disimpan atau dibagikan.
              </span>
            </div>

            <div className="mt-5 space-y-3">
              <SmallField label="Nama panggilan" required>
                <input
                  className="input-base"
                  value={form.nama_panggilan}
                  onChange={(e) => setForm({ ...form, nama_panggilan: e.target.value })}
                  required
                />
              </SmallField>
              <SmallField label="Target ikut seleksi" required>
                <select
                  className="input-base"
                  value={form.target_tahun}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      target_tahun: e.target.value as LeadFormInput["target_tahun"],
                    })
                  }
                >
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                  <option value="Belum tahu">Belum tahu</option>
                </select>
              </SmallField>
              <SmallField label="Rencana" required>
                <select
                  className="input-base"
                  value={form.rencana}
                  onChange={(e) =>
                    setForm({ ...form, rencana: e.target.value as LeadFormInput["rencana"] })
                  }
                >
                  <option value="Pakai nilai lama">Pakai nilai lama</option>
                  <option value="Tes ulang">Tes ulang</option>
                  <option value="Belum yakin">Belum yakin</option>
                </select>
              </SmallField>
              <SmallField label="Bandingkan dengan target" required>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    className="input-base target-input"
                    value={targetSearch}
                    onChange={(event) => {
                      if (selectedTarget) {
                        setSelectedTarget(null);
                        setForm({
                          ...form,
                          target_formation_id: "",
                          target_instansi: "",
                          target_formasi: "",
                        });
                      }
                      setTargetSearch(event.target.value);
                    }}
                    placeholder="Cari instansi atau jabatan"
                    autoComplete="off"
                    required
                  />
                  {targetQuery.isFetching ? (
                    <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                  ) : targetSearch ? (
                    <button
                      type="button"
                      onClick={clearTarget}
                      className="absolute right-2 top-1.5 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Hapus target"
                      aria-label="Hapus target"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}

                  {!selectedTarget && deferredTargetSearch.length >= 2 ? (
                    <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
                      {targetQuery.isError ? (
                        <p className="p-3 text-xs text-destructive">Target belum dapat dimuat.</p>
                      ) : targetQuery.data?.length ? (
                        targetQuery.data.map((target) => (
                          <button
                            key={target.id}
                            type="button"
                            onClick={() => chooseTarget(target)}
                            className="block w-full border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-muted/70"
                          >
                            <span className="block text-xs font-bold text-foreground">
                              {target.position}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {target.institution}
                            </span>
                            <span className="mt-1 block text-[11px] text-muted-foreground">
                              Kuota {target.quota} | Batas {target.cutoff_total ?? "-"} | Selisih{" "}
                              {target.score_gap === null
                                ? "-"
                                : target.score_gap > 0
                                  ? `+${target.score_gap}`
                                  : target.score_gap}
                            </span>
                          </button>
                        ))
                      ) : !targetQuery.isFetching ? (
                        <p className="p-3 text-xs text-muted-foreground">
                          Tidak ada formasi UMUM yang cocok dengan pendidikan dan pencarian ini.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </SmallField>

              {selectedTarget ? (
                <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold">Target terpilih</p>
                    <p className="mt-0.5 break-words">{selectedTarget.position}</p>
                    <p className="mt-0.5 break-words opacity-80">{selectedTarget.institution}</p>
                  </div>
                </div>
              ) : (
                <p className="px-1 text-[11px] text-muted-foreground">
                  Hanya formasi UMUM terverifikasi yang menerima pendidikan{" "}
                  {s.pendidikan ?? "peserta"}.
                </p>
              )}

              <label className="mt-2 flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.consent_whatsapp}
                  onChange={(e) => setForm({ ...form, consent_whatsapp: e.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-primary)]"
                  required
                />
                <span>Saya meminta Hermes mengirim kartu hasil analisis ini melalui WhatsApp.</span>
              </label>

              <label className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.consent_marketing}
                  onChange={(e) => setForm({ ...form, consent_marketing: e.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-primary)]"
                />
                <span>
                  Saya juga bersedia menerima informasi CPNS dan tryout. Pilihan ini tidak wajib.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={mutation.isPending}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-gradient px-5 py-3 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition hover:opacity-95 disabled:opacity-60"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <MessageCircle className="h-4 w-4" />
              Buat Kode untuk Hermes
            </button>
          </form>
        </div>
      </div>

      <style>{`
        .input-base { width:100%; border-radius:.5rem; border:1px solid var(--color-border); background:var(--color-background); padding:.55rem .75rem; font-size:.875rem; outline:none; transition: box-shadow .15s, border-color .15s; }
        .input-base.target-input { padding-left:2.25rem; padding-right:2.25rem; }
        .input-base:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-primary) 20%, transparent); }
      `}</style>
    </PageShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </p>
  );
}

function SmallField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      <SiteFooter />
    </div>
  );
}
