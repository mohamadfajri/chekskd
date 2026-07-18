import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import Papa from "papaparse";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Upload, Loader2, ShieldAlert, Database } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import {
  importCsvRows,
  validateCsvRows,
  type CsvRow,
  type ImportProgress,
  type RowValidationIssue,
} from "@/services/adminService";
import { countStats, searchSkdScores } from "@/services/skdService";
import { maskNoPeserta } from "@/lib/analysis";
import { isSupabaseConfigured, supabaseConfigError } from "@/lib/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin — cpnsguru.id" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminPage,
});

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD as string | undefined;

function AdminPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [pwd, setPwd] = useState("");

  if (!unlocked) {
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-primary">
            <ShieldAlert className="h-5 w-5" /> <h1 className="text-lg font-bold">Admin Login</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Halaman internal. Gunakan password admin.
          </p>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ADMIN_PASSWORD) return toast.error("VITE_ADMIN_PASSWORD belum di-set.");
              if (pwd === ADMIN_PASSWORD) setUnlocked(true);
              else toast.error("Password salah.");
            }}
          >
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="input-base"
              placeholder="Password"
              autoFocus
            />
            <button className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
              Masuk
            </button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Catatan: Password statis via env untuk MVP. Ganti dengan auth sebelum produksi.
          </p>
        </div>
        <LocalStyle />
      </Shell>
    );
  }

  return (
    <Shell>
      <AdminDashboard />
      <LocalStyle />
    </Shell>
  );
}

function AdminDashboard() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<RowValidationIssue[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: countStats,
    enabled: isSupabaseConfigured,
  });

  const preview = useMemo(() => rows.slice(0, 10), [rows]);

  const importMut = useMutation({
    mutationFn: () => importCsvRows(rows, (p) => setProgress({ ...p })),
    onSuccess: (p) => {
      toast.success(`Import selesai: ${p.scoresInserted} nilai, ${p.formationsCreated} formasi.`);
      stats.refetch();
    },
    onError: (e: Error) => toast.error("Import gagal: " + e.message),
  });

  const searchMut = useMutation({
    mutationFn: () => searchSkdScores({ nama: searchTerm, limit: 25 }),
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const { valid, invalid } = validateCsvRows(res.data);
        setRows(valid);
        setInvalidRows(invalid);
        setProgress(null);
        if (invalid.length > 0) {
          toast.warning(
            `CSV terbaca: ${res.data.length} baris. ${valid.length} valid, ${invalid.length} ditolak.`,
          );
        } else {
          toast.success(`CSV terbaca: ${res.data.length} baris, semua valid.`);
        }
      },
      error: (err) => toast.error("Gagal parse CSV: " + err.message),
    });
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Admin · cpnsguru.id</h1>
      <p className="mt-1 text-sm text-muted-foreground">Import data CSV dan lihat ringkasan.</p>

      {!isSupabaseConfigured && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Supabase belum siap.</p>
          <p className="mt-1">
            {supabaseConfigError ??
              "Set VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY pada environment."}
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <StatCard label="Total peserta (scores)" value={stats.data?.scores ?? "—"} />
        <StatCard label="Total formasi" value={stats.data?.formations ?? "—"} />
      </div>

      {/* Upload */}
      <section className="mt-8 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Upload className="h-4 w-4 text-primary" /> Upload CSV
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Kolom:{" "}
          <code className="text-xs">
            tahun, nama_instansi, kode_instansi, jabatan, kode_jabatan, lokasi_formasi,
            jenis_formasi, pendidikan, jumlah_formasi, no_peserta, nama, tahun_skd, twk, tiu, tkp,
            total, keterangan, source_pdf, source_page
          </code>
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground hover:file:opacity-90"
          />
          {rows.length > 0 && (
            <button
              disabled={importMut.isPending || !isSupabaseConfigured}
              onClick={() => importMut.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-95 disabled:opacity-60"
            >
              {importMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Database className="h-4 w-4" />
              )}
              Import {rows.length} baris valid ke Supabase
            </button>
          )}
        </div>

        {progress && (
          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-xs">
            <p>
              Diproses: {progress.processed} · Formasi dibuat: {progress.formationsCreated} · Nilai
              di-insert: {progress.scoresInserted}
            </p>
            {progress.errors.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-destructive">
                {progress.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {preview.length > 0 && (
          <div className="mt-5 overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  {Object.keys(preview[0])
                    .slice(0, 8)
                    .map((k) => (
                      <th key={k} className="whitespace-nowrap px-2 py-2 text-left font-semibold">
                        {k}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    {Object.keys(preview[0])
                      .slice(0, 8)
                      .map((k) => (
                        <td key={k} className="whitespace-nowrap px-2 py-1.5">
                          {String((r as Record<string, unknown>)[k] ?? "")}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground">
              Preview 10 baris pertama · menampilkan 8 kolom awal.
            </p>
          </div>
        )}

        {invalidRows.length > 0 && (
          <div className="mt-5 overflow-x-auto rounded-lg border border-destructive/40 bg-destructive/5">
            <p className="border-b border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive">
              {invalidRows.length} baris ditolak — perbaiki di CSV lalu upload ulang.
            </p>
            <table className="min-w-full text-xs">
              <thead className="bg-destructive/10">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">Baris</th>
                  <th className="px-2 py-2 text-left font-semibold">Nama</th>
                  <th className="px-2 py-2 text-left font-semibold">Instansi</th>
                  <th className="px-2 py-2 text-left font-semibold">Total</th>
                  <th className="px-2 py-2 text-left font-semibold">Kesalahan</th>
                </tr>
              </thead>
              <tbody>
                {invalidRows.slice(0, 25).map((r) => (
                  <tr key={r.index} className="border-t border-destructive/20 align-top">
                    <td className="px-2 py-1.5 font-mono">{r.index + 2}</td>
                    <td className="px-2 py-1.5">{r.row.nama ?? "-"}</td>
                    <td className="px-2 py-1.5">
                      {r.row.nama_instansi ?? r.row.kode_instansi ?? "-"}
                    </td>
                    <td className="px-2 py-1.5">{r.row.total ?? "-"}</td>
                    <td className="px-2 py-1.5 text-destructive">{r.errors.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invalidRows.length > 25 && (
              <p className="border-t border-destructive/30 px-3 py-1 text-[10px] text-destructive/80">
                Menampilkan 25 dari {invalidRows.length} baris bermasalah.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Search */}
      <section className="mt-8 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">Cari Data Peserta</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isSupabaseConfigured) return;
            searchMut.mutate();
          }}
        >
          <input
            className="input-base"
            placeholder="Nama peserta"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button
            disabled={!isSupabaseConfigured}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {searchMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cari"}
          </button>
        </form>
        {searchMut.data && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">Nama</th>
                  <th className="px-2 py-2 text-left font-semibold">No Peserta</th>
                  <th className="px-2 py-2 text-left font-semibold">Instansi</th>
                  <th className="px-2 py-2 text-left font-semibold">Formasi</th>
                  <th className="px-2 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {searchMut.data.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-2 py-1.5">{r.nama}</td>
                    <td className="px-2 py-1.5 font-mono">{maskNoPeserta(r.no_peserta)}</td>
                    <td className="px-2 py-1.5">{r.skd_formations?.nama_instansi ?? "-"}</td>
                    <td className="px-2 py-1.5">{r.skd_formations?.jabatan ?? "-"}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">{r.total ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-primary">{value}</p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      <SiteFooter />
    </div>
  );
}

function LocalStyle() {
  return (
    <style>{`
      .input-base { width:100%; border-radius:.5rem; border:1px solid var(--color-border); background:var(--color-background); padding:.55rem .75rem; font-size:.875rem; outline:none; transition: box-shadow .15s, border-color .15s; }
      .input-base:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-primary) 20%, transparent); }
    `}</style>
  );
}
