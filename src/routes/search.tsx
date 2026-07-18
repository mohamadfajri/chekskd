import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, Loader2, AlertCircle, Inbox } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import { searchSkdScores } from "@/services/skdService";
import { isSupabaseConfigured, supabaseConfigError } from "@/lib/supabase/client";
import { maskNoPeserta } from "@/lib/analysis";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Cari Data SKD — cpnsguru.id" },
      {
        name: "description",
        content: "Cari data nilai SKD berdasarkan nama, nomor peserta, instansi, atau formasi.",
      },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const [nama, setNama] = useState("");
  const [noPeserta, setNoPeserta] = useState("");
  const [instansi, setInstansi] = useState("");
  const [formasi, setFormasi] = useState("");

  const mutation = useMutation({
    mutationFn: () => searchSkdScores({ nama, no_peserta: noPeserta, instansi, formasi }),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nama.trim() && !noPeserta.trim()) return;
    mutation.mutate();
  }

  const results = mutation.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Cari Data SKD</h1>
          <p className="mt-2 text-muted-foreground">
            Masukkan nama peserta. Nomor peserta, instansi, dan formasi bersifat opsional untuk
            mempersempit hasil.
          </p>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Supabase belum siap.</p>
              <p className="mt-1">
                {supabaseConfigError ??
                  "Set VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY pada environment."}
              </p>
            </div>
          </div>
        )}

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama peserta" required>
              <input
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                placeholder="Contoh: Andi Saputra"
                className="input-base"
                required
              />
            </Field>
            <Field label="Nomor peserta (opsional)">
              <input
                value={noPeserta}
                onChange={(e) => setNoPeserta(e.target.value)}
                placeholder="Contoh: 12345678"
                className="input-base"
              />
            </Field>
            <Field label="Instansi (opsional)">
              <input
                value={instansi}
                onChange={(e) => setInstansi(e.target.value)}
                placeholder="Contoh: Kementerian Keuangan"
                className="input-base"
              />
            </Field>
            <Field label="Formasi/Jabatan (opsional)">
              <input
                value={formasi}
                onChange={(e) => setFormasi(e.target.value)}
                placeholder="Contoh: Analis Kebijakan"
                className="input-base"
              />
            </Field>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Pencarian menggunakan pencocokan sebagian (case-insensitive).
            </p>
            <button
              type="submit"
              disabled={mutation.isPending || !isSupabaseConfigured}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition hover:opacity-95 disabled:opacity-60"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Cari Data SKD
            </button>
          </div>
        </form>

        <section className="mt-8">
          {mutation.isError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Gagal mencari data: {(mutation.error as Error).message}
            </div>
          )}

          {mutation.isSuccess && results.length === 0 && (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted/40 p-10 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-3 font-semibold">Data tidak ditemukan</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Coba variasikan ejaan nama, atau hilangkan filter instansi/formasi agar hasil lebih
                luas.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                {results.length} hasil ditemukan
              </h2>
              <div className="space-y-3">
                {results.map((r) => {
                  const f = r.skd_formations;
                  return (
                    <div
                      key={r.id}
                      className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md sm:p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-base font-semibold">{r.nama}</h3>
                            {r.tahun_skd && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                SKD {r.tahun_skd}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            No. Peserta:{" "}
                            <span className="font-mono">{maskNoPeserta(r.no_peserta)}</span>
                          </p>
                          <p className="mt-2 text-sm">
                            <span className="text-muted-foreground">Instansi: </span>
                            <span className="font-medium">{f?.nama_instansi ?? "-"}</span>
                          </p>
                          <p className="text-sm">
                            <span className="text-muted-foreground">Formasi: </span>
                            <span className="font-medium">{f?.jabatan ?? "-"}</span>
                          </p>
                        </div>
                        <Link
                          to="/result/$scoreId"
                          params={{ scoreId: r.id }}
                          className="inline-flex shrink-0 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                        >
                          Ini Data Saya
                        </Link>
                      </div>
                      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                        {[
                          { l: "TWK", v: r.twk },
                          { l: "TIU", v: r.tiu },
                          { l: "TKP", v: r.tkp },
                          { l: "Total", v: r.total, hi: true },
                        ].map((c) => (
                          <div
                            key={c.l}
                            className={`rounded-lg p-2 ${c.hi ? "bg-brand-soft" : "bg-muted"}`}
                          >
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {c.l}
                            </div>
                            <div
                              className={`text-lg font-bold ${c.hi ? "text-primary" : "text-foreground"}`}
                            >
                              {c.v ?? "-"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </main>

      <SiteFooter />

      {/* Local input style */}
      <style>{`
        .input-base {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid var(--color-border);
          background-color: var(--color-background);
          padding: 0.55rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
          transition: box-shadow .15s, border-color .15s;
        }
        .input-base:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-primary) 20%, transparent); }
      `}</style>
    </div>
  );
}

function Field({
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
      <span className="mb-1.5 block text-xs font-semibold text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
