import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  ExternalLink,
  FileCheck2,
  FileText,
  HardDrive,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSkdBatches,
  getSkdReviewRows,
  importCsvRows,
  validateAdminPassword,
  validateAdminSession,
  validateCsvRows,
  type CsvRow,
  type ImportProgress,
  type RowValidationIssue,
  type SkdBatchSummary,
  type SkdReviewRow,
} from "@/services/adminService";
import { countStats, searchSkdScores } from "@/services/skdService";
import { maskNoPeserta } from "@/lib/analysis";
import { isSupabaseConfigured, supabaseConfigError } from "@/lib/supabase/client";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "SKD Data Desk" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminPage,
});

type AdminView = "review" | "import" | "published";

const NAV_ITEMS: Array<{
  id: AdminView;
  label: string;
  icon: typeof FileCheck2;
}> = [
  { id: "review", label: "Review data", icon: FileCheck2 },
  { id: "import", label: "Import batch", icon: Upload },
  { id: "published", label: "Data published", icon: Database },
];

function AdminPage() {
  const [adminPassword, setAdminPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    validateAdminSession()
      .then(() => setUnlocked(true))
      .catch(() => undefined)
      .finally(() => setCheckingSession(false));
  }, []);

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f7fb] text-[#65768a]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="grid min-h-screen bg-[#f4f7fb] lg:grid-cols-[1.1fr_0.9fr]">
        <div className="hidden border-r border-[#dbe3ee] bg-[#0d2747] px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#28a87d]">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">cpnsguru.id</p>
              <p className="text-xs text-blue-100/70">Data operations</p>
            </div>
          </div>
          <div className="max-w-xl">
            <p className="font-mono text-xs uppercase text-[#73d9b6]">SKD 2024 / Quality desk</p>
            <h1 className="mt-4 max-w-lg text-4xl font-semibold leading-tight">
              Periksa hasil parser bersama dokumen sumbernya.
            </h1>
            <div className="mt-10 grid grid-cols-3 border-y border-white/15 py-5">
              <LoginMetric value="2.612" label="Halaman Kemenhub" />
              <LoginMetric value="13.855" label="Peserta staging" />
              <LoginMetric value="1.102" label="Perlu review" />
            </div>
          </div>
          <p className="text-xs text-blue-100/50">Offline PDF workspace</p>
        </div>

        <main className="flex items-center justify-center px-5 py-12">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0d6cbd] text-white">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">SKD Data Desk</p>
                <p className="text-xs text-muted-foreground">cpnsguru.id</p>
              </div>
            </div>
            <p className="font-mono text-xs font-semibold uppercase text-[#0d6cbd]">Admin access</p>
            <h2 className="mt-2 text-2xl font-semibold">Masuk ke ruang review</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Gunakan password admin server.
            </p>
            <form
              className="mt-7 space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setLoggingIn(true);
                try {
                  await validateAdminPassword(adminPassword);
                  setUnlocked(true);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Login gagal.");
                } finally {
                  setLoggingIn(false);
                }
              }}
            >
              <input
                type="text"
                name="username"
                value="admin"
                autoComplete="username"
                className="sr-only"
                tabIndex={-1}
                readOnly
                aria-hidden="true"
              />
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold">Password</span>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  className="desk-input"
                  placeholder="Masukkan password"
                  autoComplete="current-password"
                  autoFocus
                  required
                />
              </label>
              <button
                disabled={loggingIn}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0d6cbd] px-4 text-sm font-semibold text-white hover:bg-[#0b5ca2] disabled:opacity-60"
              >
                {loggingIn ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Masuk
              </button>
            </form>
          </div>
        </main>
        <DeskStyle />
      </div>
    );
  }

  return <AdminWorkspace adminPassword={adminPassword} />;
}

function AdminWorkspace({ adminPassword }: { adminPassword: string }) {
  const [activeView, setActiveView] = useState<AdminView>("review");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const batches = useQuery({
    queryKey: ["admin-skd-batches", adminPassword],
    queryFn: () => getSkdBatches(adminPassword),
  });
  const stats = useQuery({
    queryKey: ["admin-public-stats"],
    queryFn: countStats,
    enabled: isSupabaseConfigured,
  });

  useEffect(() => {
    if (!selectedBatchId && batches.data?.length) setSelectedBatchId(batches.data[0].id);
  }, [batches.data, selectedBatchId]);

  const selectedBatch = batches.data?.find((batch) => batch.id === selectedBatchId) ?? null;

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#172638]">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#dbe3ee] bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#0d6cbd] text-white">
            <Database className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">SKD Data Desk</p>
            <p className="hidden text-[11px] text-[#65768a] sm:block">cpnsguru.id / 2024</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-[#cfe7dd] bg-[#eef9f5] px-2.5 py-1 text-[11px] font-semibold text-[#20795d] sm:inline-flex">
            <HardDrive className="h-3 w-3" /> PDF offline
          </span>
          <button
            type="button"
            onClick={() => batches.refetch()}
            className="desk-icon-button"
            title="Muat ulang data"
            aria-label="Muat ulang data"
          >
            <RefreshCw className={`h-4 w-4 ${batches.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b border-[#dbe3ee] bg-white lg:min-h-[calc(100vh-3.5rem)] lg:border-b-0 lg:border-r">
          <nav className="flex gap-1 overflow-x-auto p-2 lg:block lg:space-y-1 lg:p-3">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition lg:w-full ${
                    active
                      ? "bg-[#eaf3fb] text-[#0d5f9f]"
                      : "text-[#536579] hover:bg-[#f3f6f9] hover:text-[#172638]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="mx-4 mt-4 hidden border-t border-[#e2e8f0] pt-4 lg:block">
            <p className="font-mono text-[10px] uppercase text-[#8291a3]">Public dataset</p>
            <div className="mt-3 space-y-3">
              <SidebarMetric label="Peserta" value={stats.data?.scores ?? 0} />
              <SidebarMetric label="Formasi" value={stats.data?.formations ?? 0} />
              <SidebarMetric label="Batch staging" value={batches.data?.length ?? 0} />
            </div>
          </div>
        </aside>

        <main className="min-w-0 p-3 sm:p-5 lg:p-6">
          {!isSupabaseConfigured && (
            <div className="mb-4 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {supabaseConfigError ?? "Supabase belum dikonfigurasi."}
            </div>
          )}
          {activeView === "review" && (
            <ReviewWorkspace
              adminPassword={adminPassword}
              batches={batches.data ?? []}
              batchesLoading={batches.isLoading}
              selectedBatch={selectedBatch}
              onSelectBatch={setSelectedBatchId}
            />
          )}
          {activeView === "import" && (
            <ImportWorkspace adminPassword={adminPassword} onImported={() => batches.refetch()} />
          )}
          {activeView === "published" && <PublishedWorkspace />}
        </main>
      </div>
      <DeskStyle />
    </div>
  );
}

function ReviewWorkspace({
  adminPassword,
  batches,
  batchesLoading,
  selectedBatch,
  onSelectBatch,
}: {
  adminPassword: string;
  batches: SkdBatchSummary[];
  batchesLoading: boolean;
  selectedBatch: SkdBatchSummary | null;
  onSelectBatch: (id: string) => void;
}) {
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [issueSearch, setIssueSearch] = useState("");

  const reviewRows = useQuery({
    queryKey: ["admin-skd-review", selectedBatch?.id, adminPassword],
    queryFn: () => getSkdReviewRows(adminPassword, selectedBatch!.id),
    enabled: Boolean(selectedBatch),
  });

  const filteredIssues = useMemo(() => {
    const needle = issueSearch.trim().toLowerCase();
    const matches = needle
      ? (reviewRows.data ?? []).filter((row) =>
          [row.nama, row.no_peserta, row.pendidikan_raw, row.formation_name, row.raw_value]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle)),
        )
      : (reviewRows.data ?? []);
    return [...matches].sort(
      (left, right) =>
        (left.source_page ?? Number.MAX_SAFE_INTEGER) -
        (right.source_page ?? Number.MAX_SAFE_INTEGER),
    );
  }, [issueSearch, reviewRows.data]);

  useEffect(() => {
    if (!filteredIssues.length) {
      setSelectedIssueId(null);
      return;
    }
    if (!filteredIssues.some((row) => row.id === selectedIssueId)) {
      setSelectedIssueId(filteredIssues[0].id);
    }
  }, [filteredIssues, selectedIssueId]);

  const selectedIssue =
    filteredIssues.find((row) => row.id === selectedIssueId) ?? filteredIssues[0] ?? null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase text-[#0d6cbd]">
            Quality control
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Review data SKD</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#65768a]">
          <span className="h-2 w-2 rounded-full bg-[#28a87d]" />
          Database tersambung
        </div>
      </div>

      <div className="grid overflow-hidden rounded-lg border border-[#d8e1ec] bg-white shadow-sm xl:grid-cols-[220px_minmax(0,1fr)]">
        <div className="border-b border-[#d8e1ec] bg-[#f9fbfd] xl:border-b-0 xl:border-r">
          <div className="border-b border-[#e2e8f0] px-4 py-3">
            <p className="text-xs font-semibold">Batch instansi</p>
            <p className="mt-0.5 text-[11px] text-[#718196]">{batches.length} batch tersedia</p>
          </div>
          <div className="flex gap-2 overflow-x-auto p-2 xl:block xl:max-h-[calc(100vh-13rem)] xl:space-y-1 xl:overflow-y-auto">
            {batchesLoading && (
              <p className="flex items-center gap-2 p-3 text-xs text-[#718196]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat batch
              </p>
            )}
            {batches.map((batch) => (
              <BatchButton
                key={batch.id}
                batch={batch}
                active={batch.id === selectedBatch?.id}
                onClick={() => onSelectBatch(batch.id)}
              />
            ))}
          </div>
        </div>

        <div className="min-w-0">
          {selectedBatch ? (
            <>
              <BatchHeader batch={selectedBatch} />
              <div className="grid min-h-[720px] lg:grid-cols-[300px_minmax(0,1fr)]">
                <div className="min-w-0 border-b border-[#d8e1ec] lg:border-b-0 lg:border-r">
                  <div className="flex items-center gap-2 border-b border-[#e2e8f0] p-3">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#8a99aa]" />
                      <input
                        value={issueSearch}
                        onChange={(event) => setIssueSearch(event.target.value)}
                        className="desk-input h-9 pl-9"
                        placeholder="Cari peserta atau pendidikan"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => reviewRows.refetch()}
                      className="desk-icon-button h-9 w-9"
                      title="Muat ulang issue"
                      aria-label="Muat ulang issue"
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${reviewRows.isFetching ? "animate-spin" : ""}`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-between border-b border-[#e8edf3] px-3 py-2 text-[11px] text-[#718196]">
                    <span>{filteredIssues.length} dari maksimal 200 issue terbuka</span>
                    <span>Urut halaman sumber</span>
                  </div>
                  <div className="max-h-[640px] overflow-y-auto">
                    {reviewRows.isLoading && <LoadingRows />}
                    {reviewRows.isError && (
                      <p className="p-4 text-sm text-red-700">
                        {(reviewRows.error as Error).message}
                      </p>
                    )}
                    {!reviewRows.isLoading && filteredIssues.length === 0 && (
                      <div className="p-8 text-center">
                        <CheckCircle2 className="mx-auto h-7 w-7 text-[#28a87d]" />
                        <p className="mt-2 text-sm font-semibold">Tidak ada issue ditemukan</p>
                      </div>
                    )}
                    {filteredIssues.map((issue) => (
                      <IssueRow
                        key={issue.id}
                        issue={issue}
                        active={issue.id === selectedIssue?.id}
                        onClick={() => setSelectedIssueId(issue.id)}
                      />
                    ))}
                  </div>
                </div>
                <PdfInspector issue={selectedIssue} />
              </div>
            </>
          ) : (
            <div className="flex min-h-[520px] items-center justify-center p-8 text-center">
              <div>
                <Layers3 className="mx-auto h-8 w-8 text-[#8da0b4]" />
                <p className="mt-3 text-sm font-semibold">Pilih batch untuk mulai review</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BatchHeader({ batch }: { batch: SkdBatchSummary }) {
  const cleanEstimate = Math.max(batch.participant_count - batch.review_issue_count, 0);
  const progress = batch.participant_count
    ? Math.round((cleanEstimate / batch.participant_count) * 100)
    : 0;
  return (
    <div className="border-b border-[#d8e1ec]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{batch.institution_name}</h2>
            <StatusBadge status={batch.status} />
          </div>
          <p className="mt-1 text-xs text-[#65768a]">
            {batch.selection_year} · {batch.parser_family} v{batch.parser_version}
          </p>
        </div>
        <div className="w-40">
          <div className="flex justify-between text-[11px] text-[#65768a]">
            <span>Terbaca konsisten</span>
            <strong className="text-[#172638]">{progress}%</strong>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e3eaf2]">
            <div className="h-full bg-[#28a87d]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-[#edf1f5] bg-[#fbfcfe]">
        <BatchMetric icon={Layers3} label="Formasi" value={batch.formation_count} />
        <BatchMetric icon={Users} label="Peserta" value={batch.participant_count} />
        <BatchMetric
          icon={AlertTriangle}
          label="Issue terbuka"
          value={batch.review_issue_count}
          warning
        />
      </div>
    </div>
  );
}

function BatchButton({
  batch,
  active,
  onClick,
}: {
  batch: SkdBatchSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-60 items-center gap-3 rounded-md border px-3 py-3 text-left transition xl:w-full xl:min-w-0 ${
        active
          ? "border-[#b9d8ef] bg-[#eaf3fb]"
          : "border-transparent bg-white hover:border-[#dbe3ec]"
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          active ? "bg-[#0d6cbd] text-white" : "bg-[#edf2f7] text-[#65768a]"
        }`}
      >
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{batch.institution_name}</p>
        <p className="mt-1 text-[10px] text-[#718196]">
          {batch.participant_count.toLocaleString("id-ID")} peserta · {batch.review_issue_count}{" "}
          issue
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#8a99aa]" />
    </button>
  );
}

function IssueRow({
  issue,
  active,
  onClick,
}: {
  issue: SkdReviewRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full border-b border-[#edf1f5] px-3 py-3 text-left transition ${
        active ? "border-l-4 border-l-[#0d6cbd] bg-[#eef6fc] pl-2" : "hover:bg-[#f8fafc]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{issue.nama ?? "Formasi"}</p>
          <p className="mt-0.5 font-mono text-[10px] text-[#718196]">
            {issue.no_peserta ?? "Tanpa nomor peserta"}
          </p>
        </div>
        <span className="shrink-0 rounded-sm bg-[#fff1d6] px-1.5 py-0.5 text-[10px] font-semibold text-[#9b5d00]">
          Hal. {issue.source_page ?? "-"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] gap-3">
        <p className="line-clamp-2 text-[11px] leading-4 text-[#536579]">
          {issue.pendidikan_raw ?? issue.raw_value ?? issue.issue_code}
        </p>
        <span className="font-mono text-[10px] text-[#718196]">
          {issue.confidence == null ? "-" : `${Math.round(issue.confidence * 100)}%`}
        </span>
      </div>
    </button>
  );
}

function PdfInspector({ issue }: { issue: SkdReviewRow | null }) {
  if (!issue) {
    return (
      <div className="flex min-h-[520px] items-center justify-center bg-[#edf1f5] p-8 text-center">
        <div>
          <FileText className="mx-auto h-8 w-8 text-[#8da0b4]" />
          <p className="mt-3 text-sm font-semibold">Pilih issue untuk membuka PDF</p>
        </div>
      </div>
    );
  }

  const pdfUrl = issue.source_id
    ? `/api/admin/skd-pdf?sourceId=${encodeURIComponent(issue.source_id)}#page=${issue.source_page ?? 1}&zoom=page-width`
    : null;

  return (
    <div className="min-w-0 bg-[#e8edf3]">
      <div className="border-b border-[#cfd8e3] bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">
              {issue.source_file_name ?? "PDF sumber"}
            </p>
            <p className="mt-0.5 text-[11px] text-[#65768a]">
              Halaman PDF {issue.source_page ?? "-"} · sumber offline
            </p>
          </div>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="desk-icon-button"
              title="Buka PDF di tab baru"
              aria-label="Buka PDF di tab baru"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
        <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
          <CompareValue label="Teks PDF" value={issue.pendidikan_raw ?? "-"} />
          <CompareValue label="Hasil parser" value={issue.pendidikan ?? "-"} />
        </div>
      </div>
      {pdfUrl ? (
        <iframe
          key={`${issue.id}-${issue.source_page}`}
          src={pdfUrl}
          title={`PDF ${issue.source_file_name ?? "sumber"} halaman ${issue.source_page ?? 1}`}
          className="h-[620px] w-full bg-[#dfe5ec]"
        />
      ) : (
        <div className="flex h-[620px] items-center justify-center p-8 text-center text-sm text-[#65768a]">
          Source ID PDF tidak tersedia.
        </div>
      )}
    </div>
  );
}

function ImportWorkspace({
  adminPassword,
  onImported,
}: {
  adminPassword: string;
  onImported: () => void;
}) {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<RowValidationIssue[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

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

  const importMutation = useMutation({
    mutationFn: () => {
      if (!reviewConfirmed || invalidRows.length > 0) {
        throw new Error("Pemeriksaan file staging belum dikonfirmasi.");
      }
      return importCsvRows(rows, adminPassword, (next) => setProgress({ ...next }));
    },
    onSuccess: (result) => {
      toast.success(
        `Batch masuk staging: ${result.scoresInserted} peserta, ${result.issuesCreated} issue.`,
      );
      onImported();
    },
    onError: (error: Error) => toast.error(`Import gagal: ${error.message}`),
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
        toast[validation.invalid.length ? "warning" : "success"](
          `${validation.valid.length} record lolos, ${validation.invalid.length} ditolak.`,
        );
      },
      error: (error) => toast.error(`Gagal membaca CSV: ${error.message}`),
    });
  }

  return (
    <div className="max-w-6xl">
      <p className="font-mono text-[11px] font-semibold uppercase text-[#0d6cbd]">Data intake</p>
      <h1 className="mt-1 text-2xl font-semibold">Import batch instansi</h1>
      <div className="mt-5 overflow-hidden rounded-lg border border-[#d8e1ec] bg-white shadow-sm">
        <div className="border-b border-[#e2e8f0] px-5 py-4">
          <h2 className="text-sm font-semibold">CSV parser v3</h2>
          <p className="mt-1 text-xs text-[#65768a]">Batch baru masuk ke status review.</p>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#0d6cbd] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0b5ca2]">
              <Upload className="h-4 w-4" /> Pilih CSV
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" />
            </label>
            <span className="text-xs text-[#65768a]">
              {rows.length
                ? `${rows.length.toLocaleString("id-ID")} record dibaca`
                : "Belum ada file"}
            </span>
          </div>

          {rows.length > 0 && (
            <>
              <div className="mt-5 grid border-y border-[#e2e8f0] sm:grid-cols-4">
                <ImportMetric label="Peserta" value={participantRows.length} />
                <ImportMetric label="Formasi" value={formationCount} />
                <ImportMetric label="Perlu review" value={reviewCount} warning />
                <ImportMetric label="Ditolak" value={invalidRows.length} danger />
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewConfirmed}
                    disabled={invalidRows.length > 0}
                    onChange={(event) => setReviewConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#0d6cbd]"
                  />
                  Metadata batch dan sampel PDF sudah diperiksa.
                </label>
                <button
                  type="button"
                  disabled={importMutation.isPending || !reviewConfirmed || invalidRows.length > 0}
                  onClick={() => importMutation.mutate()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#172f4d] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {importMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Database className="h-4 w-4" />
                  )}
                  Masukkan ke staging
                </button>
              </div>
            </>
          )}
          {progress && (
            <p className="mt-4 bg-[#eef6fc] p-3 text-xs text-[#245e88]">
              {progress.processed} peserta diproses · {progress.formationsCreated} formasi ·{" "}
              {progress.issuesCreated} issue
            </p>
          )}
        </div>
        {invalidRows.length > 0 && <InvalidPreview rows={invalidRows} />}
      </div>
    </div>
  );
}

function PublishedWorkspace() {
  const [searchTerm, setSearchTerm] = useState("");
  const searchMutation = useMutation({
    mutationFn: () => searchSkdScores({ nama: searchTerm, limit: 25 }),
  });

  return (
    <div className="max-w-6xl">
      <p className="font-mono text-[11px] font-semibold uppercase text-[#0d6cbd]">Public index</p>
      <h1 className="mt-1 text-2xl font-semibold">Data published</h1>
      <div className="mt-5 overflow-hidden rounded-lg border border-[#d8e1ec] bg-white shadow-sm">
        <form
          className="flex gap-2 border-b border-[#e2e8f0] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isSupabaseConfigured && searchTerm.trim()) searchMutation.mutate();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#8a99aa]" />
            <input
              className="desk-input h-9 pl-9"
              placeholder="Cari nama peserta"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <button className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0d6cbd] px-4 text-sm font-semibold text-white">
            {searchMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Cari
          </button>
        </form>
        {searchMutation.data?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-[#f7f9fc] text-[#536579]">
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
                  <tr key={row.id} className="border-t border-[#edf1f5]">
                    <td className="px-3 py-3 font-semibold">{row.nama}</td>
                    <td className="px-3 py-3 font-mono">{maskNoPeserta(row.no_peserta)}</td>
                    <td className="px-3 py-3">{row.skd_formations?.nama_instansi ?? "-"}</td>
                    <td className="px-3 py-3">{row.skd_formations?.jabatan ?? "-"}</td>
                    <td className="px-3 py-3 text-right font-semibold">{row.total ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-[#718196]">
            {searchMutation.data ? "Data tidak ditemukan." : "Masukkan nama peserta untuk mencari."}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SkdBatchSummary["status"] }) {
  const style =
    status === "published"
      ? "bg-[#e8f7f1] text-[#20795d]"
      : status === "review"
        ? "bg-[#fff1d6] text-[#965d05]"
        : "bg-[#edf2f7] text-[#536579]";
  return (
    <span className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold ${style}`}>{status}</span>
  );
}

function BatchMetric({
  icon: Icon,
  label,
  value,
  warning = false,
}: {
  icon: typeof Layers3;
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-r border-[#edf1f5] px-3 py-3 last:border-r-0 sm:px-5">
      <Icon className={`h-4 w-4 ${warning ? "text-[#c47909]" : "text-[#5c7188]"}`} />
      <div>
        <p className="text-[10px] text-[#718196]">{label}</p>
        <p className="text-sm font-semibold">{value.toLocaleString("id-ID")}</p>
      </div>
    </div>
  );
}

function CompareValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-l-2 border-[#c8d7e5] pl-2">
      <p className="font-mono text-[9px] uppercase text-[#8291a3]">{label}</p>
      <p className="mt-0.5 line-clamp-2 leading-4 text-[#34485e]">{value}</p>
    </div>
  );
}

function ImportMetric({
  label,
  value,
  warning = false,
  danger = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
  danger?: boolean;
}) {
  const color = danger ? "text-red-700" : warning ? "text-[#a46608]" : "text-[#172638]";
  return (
    <div className="border-b border-[#e2e8f0] px-3 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-[10px] text-[#718196]">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${color}`}>{value.toLocaleString("id-ID")}</p>
    </div>
  );
}

function SidebarMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[#718196]">{label}</span>
      <strong>{value.toLocaleString("id-ID")}</strong>
    </div>
  );
}

function LoginMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-r border-white/15 px-4 first:pl-0 last:border-r-0">
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] text-blue-100/60">{label}</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y divide-[#edf1f5]">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="animate-pulse px-3 py-4">
          <div className="h-3 w-2/3 rounded bg-[#e5ebf1]" />
          <div className="mt-2 h-2.5 w-1/3 rounded bg-[#edf1f5]" />
          <div className="mt-3 h-2.5 w-5/6 rounded bg-[#edf1f5]" />
        </div>
      ))}
    </div>
  );
}

function InvalidPreview({ rows }: { rows: RowValidationIssue[] }) {
  return (
    <div className="border-t border-red-200 bg-red-50">
      <div className="flex items-center gap-2 px-5 py-3 text-xs font-semibold text-red-800">
        <AlertTriangle className="h-4 w-4" /> {rows.length} record ditolak
      </div>
      <div className="max-h-72 overflow-auto border-t border-red-200">
        <table className="min-w-full text-xs">
          <thead>
            <tr>
              <TableHead>Baris</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead>Kesalahan</TableHead>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 25).map((issue) => (
              <tr key={issue.index} className="border-t border-red-100">
                <td className="px-3 py-2 font-mono">{issue.index + 2}</td>
                <td className="px-3 py-2">{issue.row.nama ?? "Formasi"}</td>
                <td className="px-3 py-2 text-red-700">{issue.errors.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
      className={`whitespace-nowrap px-3 py-2.5 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function DeskStyle() {
  return (
    <style>{`
      .desk-input { width:100%; border-radius:.5rem; border:1px solid #cfd9e5; background:#fff; padding:.55rem .75rem; font-size:.875rem; outline:none; transition:border-color .15s, box-shadow .15s; }
      .desk-input:focus { border-color:#0d6cbd; box-shadow:0 0 0 3px rgba(13,108,189,.12); }
      .desk-icon-button { display:inline-flex; height:2rem; width:2rem; flex-shrink:0; align-items:center; justify-content:center; border:1px solid #d6e0ea; border-radius:.375rem; background:#fff; color:#536579; transition:background .15s,color .15s; }
      .desk-icon-button:hover { background:#f1f5f9; color:#172638; }
      .desk-icon-button:focus-visible, button:focus-visible, a:focus-visible { outline:2px solid #0d6cbd; outline-offset:2px; }
    `}</style>
  );
}
