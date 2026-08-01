import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import Papa from "papaparse";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Database,
  ExternalLink,
  FileSearch,
  Loader2,
  Search,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import {
  getSkdBatches,
  getSkdReviewRows,
  importCsvRows,
  validateAdminPassword,
  validateCsvRows,
  type CsvRow,
  type ImportProgress,
  type RowValidationIssue,
  type SkdReviewRow,
} from "@/services/adminService";
import { countStats, searchSkdScores } from "@/services/skdService";
import { maskNoPeserta } from "@/lib/analysis";
import { isSupabaseConfigured, supabaseConfigError } from "@/lib/supabase/client";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin - cpnsguru.id" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminPage,
});

function sampleRows<T>(items: T[], sampleSize = 12): T[] {
  if (items.length <= sampleSize) return items;
  return Array.from({ length: sampleSize }, (_, index) => {
    const itemIndex = Math.round((index * (items.length - 1)) / (sampleSize - 1));
    return items[itemIndex];
  });
}

function AdminPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  if (!unlocked) {
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 text-primary">
            <ShieldAlert className="h-5 w-5" />
            <h1 className="text-lg font-bold">Admin Login</h1>
          </div>
          <form
            className="mt-4 space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setLoggingIn(true);
              try {
                await validateAdminPassword(password);
                setUnlocked(true);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Login gagal.");
              } finally {
                setLoggingIn(false);
              }
            }}
          >
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input-base"
              placeholder="Password"
              autoFocus
              required
            />
            <button
              disabled={loggingIn}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {loggingIn && <Loader2 className="h-4 w-4 animate-spin" />}
              Masuk
            </button>
          </form>
        </div>
        <LocalStyle />
      </Shell>
    );
  }

  return (
    <Shell>
      <AdminDashboard adminPassword={password} />
      <LocalStyle />
    </Shell>
  );
}

function AdminDashboard({ adminPassword }: { adminPassword: string }) {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<RowValidationIssue[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const stats = useQuery({
    queryKey: ["admin-public-stats"],
    queryFn: countStats,
    enabled: isSupabaseConfigured,
  });
  const batches = useQuery({
    queryKey: ["admin-skd-batches", adminPassword],
    queryFn: () => getSkdBatches(adminPassword),
  });
  const reviewRows = useQuery({
    queryKey: ["admin-skd-review", selectedBatchId, adminPassword],
    queryFn: () => getSkdReviewRows(adminPassword, selectedBatchId!),
    enabled: Boolean(selectedBatchId),
  });

  const participantRows = useMemo(
    () =>
      rows.filter(
        (row) => (row.record_type?.trim().toLowerCase() || "participant") === "participant",
      ),
    [rows],
  );
  const formationCount = useMemo(
    () => new Set(rows.map((row) => row.formation_instance_id).filter(Boolean)).size,
    [rows],
  );
  const reviewCount = useMemo(
    () => rows.filter((row) => row.quality_status?.toLowerCase() === "needs_review").length,
    [rows],
  );
  const preview = useMemo(() => sampleRows(participantRows), [participantRows]);

  const importMutation = useMutation({
    mutationFn: () => {
      if (!reviewConfirmed || invalidRows.length > 0) {
        throw new Error("Pemeriksaan file staging belum dikonfirmasi.");
      }
      return importCsvRows(rows, adminPassword, (next) => setProgress({ ...next }));
    },
    onSuccess: (result) => {
      toast.success(
        `Batch masuk staging: ${result.scoresInserted} peserta, ${result.issuesCreated} issue review.`,
      );
      batches.refetch();
    },
    onError: (error: Error) => toast.error(`Import staging gagal: ${error.message}`),
  });

  const searchMutation = useMutation({
    mutationFn: () => searchSkdScores({ nama: searchTerm, limit: 25 }),
  });

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const validation = validateCsvRows(result.data);
        setRows(validation.valid);
        setInvalidRows(validation.invalid);
        setProgress(null);
        setReviewConfirmed(false);
        if (validation.invalid.length) {
          toast.warning(
            `${validation.valid.length} record lolos, ${validation.invalid.length} ditolak.`,
          );
        } else {
          toast.success(`${validation.valid.length} record siap distaging.`);
        }
      },
      error: (error) => toast.error(`Gagal membaca CSV: ${error.message}`),
    });
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Fondasi Data SKD</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Batch per instansi, review kualitas, lalu publish.
      </p>

      {!isSupabaseConfigured && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {supabaseConfigError ?? "Supabase belum dikonfigurasi."}
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Batch staging" value={batches.data?.length ?? "-"} />
        <StatCard label="Peserta published" value={stats.data?.scores ?? "-"} />
        <StatCard label="Formasi published" value={stats.data?.formations ?? "-"} />
      </div>

      <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Upload className="h-4 w-4 text-primary" /> Upload Batch Instansi
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Hanya CSV parser versi 3. File akan masuk staging dan belum terlihat oleh pengguna.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="block max-w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground hover:file:opacity-90"
          />
          {rows.length > 0 && (
            <button
              disabled={importMutation.isPending || !reviewConfirmed || invalidRows.length > 0}
              onClick={() => importMutation.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Database className="h-4 w-4" />
              )}
              Masukkan ke staging
            </button>
          )}
        </div>

        {rows.length > 0 && (
          <div className="mt-4 border-y border-border py-4">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <Metric
                label="Parser"
                value={`${rows[0].parser_family} v${rows[0].parser_version}`}
              />
              <Metric label="Peserta" value={participantRows.length} />
              <Metric label="Formasi" value={formationCount} />
              <Metric label="Perlu review" value={reviewCount} warning={reviewCount > 0} />
              <Metric label="Ditolak" value={invalidRows.length} warning={invalidRows.length > 0} />
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={reviewConfirmed}
                disabled={invalidRows.length > 0}
                onChange={(event) => setReviewConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>Saya sudah memeriksa metadata batch dan sampel PDF.</span>
            </label>
          </div>
        )}

        {progress && (
          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-xs">
            Diproses {progress.processed} peserta, {progress.formationsCreated} formasi, dan{" "}
            {progress.issuesCreated} issue review.
          </div>
        )}

        {preview.length > 0 && <ParticipantPreview rows={preview} />}
        {invalidRows.length > 0 && <InvalidPreview rows={invalidRows} />}
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileSearch className="h-4 w-4 text-primary" /> Batch Data
        </h2>
        {batches.isError && (
          <p className="mt-3 text-sm text-destructive">{(batches.error as Error).message}</p>
        )}
        {batches.data && batches.data.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <TableHead>Instansi</TableHead>
                  <TableHead>Tahun</TableHead>
                  <TableHead>Parser</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Formasi</TableHead>
                  <TableHead align="right">Peserta</TableHead>
                  <TableHead align="right">Issue</TableHead>
                  <TableHead>Review</TableHead>
                </tr>
              </thead>
              <tbody>
                {batches.data.map((batch) => (
                  <tr key={batch.id} className="border-t border-border">
                    <td className="px-2 py-2 font-medium">{batch.institution_name}</td>
                    <td className="px-2 py-2">{batch.selection_year}</td>
                    <td className="px-2 py-2">
                      {batch.parser_family} v{batch.parser_version}
                    </td>
                    <td className="px-2 py-2">{batch.status}</td>
                    <td className="px-2 py-2 text-right">{batch.formation_count}</td>
                    <td className="px-2 py-2 text-right">{batch.participant_count}</td>
                    <td className="px-2 py-2 text-right">{batch.review_issue_count}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        disabled={batch.review_issue_count === 0}
                        onClick={() => setSelectedBatchId(batch.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold text-primary disabled:opacity-40"
                      >
                        <FileSearch className="h-3 w-3" /> Buka
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Belum ada batch pada schema baru.</p>
        )}
      </section>

      {selectedBatchId && (
        <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Sampel Issue Parser</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Menampilkan maksimal 100 issue terbuka. Cocokkan dengan halaman PDF asli.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedBatchId(null)}
              className="text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              Tutup
            </button>
          </div>
          {reviewRows.isLoading && (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat issue...
            </p>
          )}
          {reviewRows.isError && (
            <p className="mt-4 text-sm text-destructive">{(reviewRows.error as Error).message}</p>
          )}
          {reviewRows.data && <ReviewIssueTable rows={reviewRows.data} />}
        </section>
      )}

      <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold">Cari Data Published</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (isSupabaseConfigured) searchMutation.mutate();
          }}
        >
          <input
            className="input-base"
            placeholder="Nama peserta"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <button className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">
            {searchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </button>
        </form>
        {searchMutation.data && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <TableHead>Nama</TableHead>
                  <TableHead>No. peserta</TableHead>
                  <TableHead>Instansi</TableHead>
                  <TableHead>Formasi</TableHead>
                  <TableHead align="right">Total</TableHead>
                </tr>
              </thead>
              <tbody>
                {searchMutation.data.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-2">{row.nama}</td>
                    <td className="px-2 py-2 font-mono">{maskNoPeserta(row.no_peserta)}</td>
                    <td className="px-2 py-2">{row.skd_formations?.nama_instansi ?? "-"}</td>
                    <td className="px-2 py-2">{row.skd_formations?.jabatan ?? "-"}</td>
                    <td className="px-2 py-2 text-right font-semibold">{row.total ?? "-"}</td>
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

function ParticipantPreview({ rows }: { rows: CsvRow[] }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-xs">
        <thead className="bg-muted">
          <tr>
            <TableHead>Nama</TableHead>
            <TableHead>No. peserta</TableHead>
            <TableHead>Pendidikan</TableHead>
            <TableHead align="right">Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Kualitas</TableHead>
            <TableHead>Sumber</TableHead>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.no_peserta ?? index}-${row.source_page}`}
              className="border-t border-border"
            >
              <td className="max-w-56 px-2 py-2 font-medium">{row.nama ?? "-"}</td>
              <td className="px-2 py-2 font-mono">{row.no_peserta ?? "-"}</td>
              <td className="max-w-64 px-2 py-2">{row.pendidikan ?? "-"}</td>
              <td className="px-2 py-2 text-right font-semibold">{row.total || "-"}</td>
              <td className="px-2 py-2">{row.keterangan ?? "-"}</td>
              <td className="px-2 py-2">{row.quality_status ?? "-"}</td>
              <td className="px-2 py-2">
                {row.source_url ? (
                  <a
                    href={row.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    Hal. {row.source_page ?? "-"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  `Hal. ${row.source_page ?? "-"}`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground">
        Sampel {rows.length} peserta tersebar dari awal hingga akhir file.
      </p>
    </div>
  );
}

function ReviewIssueTable({ rows }: { rows: SkdReviewRow[] }) {
  if (!rows.length) {
    return <p className="mt-4 text-sm text-muted-foreground">Tidak ada issue terbuka.</p>;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-xs">
        <thead className="bg-muted">
          <tr>
            <TableHead>Peserta</TableHead>
            <TableHead>Pendidikan mentah</TableHead>
            <TableHead>Hasil parser</TableHead>
            <TableHead>Masalah</TableHead>
            <TableHead align="right">Confidence</TableHead>
            <TableHead>PDF</TableHead>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border align-top">
              <td className="max-w-56 px-2 py-2">
                <p className="font-semibold">{row.nama ?? "Formasi"}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {row.no_peserta ?? "-"}
                </p>
              </td>
              <td className="max-w-64 px-2 py-2">{row.pendidikan_raw ?? "-"}</td>
              <td className="max-w-64 px-2 py-2">{row.pendidikan ?? "-"}</td>
              <td className="max-w-72 px-2 py-2 text-amber-800">
                {row.raw_value ?? row.issue_code}
              </td>
              <td className="px-2 py-2 text-right">
                {row.confidence == null ? "-" : `${Math.round(row.confidence * 100)}%`}
              </td>
              <td className="whitespace-nowrap px-2 py-2">
                {row.source_url ? (
                  <a
                    href={row.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    Hal. {row.source_page ?? "-"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  `Hal. ${row.source_page ?? "-"}`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvalidPreview({ rows }: { rows: RowValidationIssue[] }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-destructive/40 bg-destructive/5">
      <p className="border-b border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive">
        {rows.length} record ditolak. Perbaiki parser lalu upload ulang.
      </p>
      <table className="min-w-full text-xs">
        <thead className="bg-destructive/10">
          <tr>
            <TableHead>Baris</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Kesalahan</TableHead>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 25).map((issue) => (
            <tr key={issue.index} className="border-t border-destructive/20">
              <td className="px-2 py-2 font-mono">{issue.index + 2}</td>
              <td className="px-2 py-2">{issue.row.nama ?? "formasi"}</td>
              <td className="px-2 py-2 text-destructive">{issue.errors.join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <span>
      {label}: <strong className={warning ? "text-amber-700" : "text-foreground"}>{value}</strong>
    </span>
  );
}

function TableHead({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`whitespace-nowrap px-2 py-2 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
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
