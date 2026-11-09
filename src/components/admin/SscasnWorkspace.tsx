import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { getAdminSscasn, saveAdminSscasnMatch } from "@/services/sscasnService";
import type { SscasnReviewRow, SscasnSnapshot } from "@/lib/sscasn";
import { SscasnAuditWorkspace } from "./SscasnAuditWorkspace";

const number = (value: number) => value.toLocaleString("id-ID");
const STATUS = { approved: "Disetujui", rejected: "Ditolak", pending: "Belum diperiksa" };

export function SscasnWorkspace({ adminPassword }: { adminPassword: string }) {
  const [tab, setTab] = useState<"catalog" | "review" | "audit">("catalog");
  const [institution, setInstitution] = useState("Kejaksaan Agung");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [reviewFilter, setReviewFilter] = useState("pending");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const data = useQuery({
    queryKey: ["admin-sscasn", adminPassword, institution, query, page],
    queryFn: () => getAdminSscasn(adminPassword, { institution, query, page }),
    enabled: tab !== "audit",
  });
  const result = data.data;
  const review = result?.review ?? [];
  const approved = review.filter((row) => row.match?.review_status === "approved").length;
  const pending = review.filter(
    (row) => !row.match || row.match.review_status === "pending",
  ).length;
  const rows = review.filter(
    (row) =>
      reviewFilter === "all" ||
      (reviewFilter === "unmatched"
        ? row.candidates.length === 0
        : (row.match?.review_status ?? "pending") === reviewFilter),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#65768a]">ARSIP 2024</p>
          <h1 className="mt-1 text-xl font-semibold">Formasi SSCASN</h1>
        </div>
        {tab !== "audit" && (
          <button
            className="desk-icon-button"
            title="Muat ulang SSCASN"
            aria-label="Muat ulang SSCASN"
            onClick={() => data.refetch()}
          >
            <RefreshCw className={`h-4 w-4 ${data.isFetching ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>
      <div
        className="flex flex-wrap gap-x-5 gap-y-1 border-b border-[#dbe3ee]"
        role="tablist"
        aria-label="Data SSCASN"
      >
        {(
          [
            ["catalog", "Daftar formasi"],
            ["review", `Pencocokan Kejaksaan${result ? ` (${approved}/${review.length})` : ""}`],
            ["audit", "Audit instansi"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`border-b-2 py-2 text-sm font-semibold ${tab === id ? "border-[#0d6cbd] text-[#0d6cbd]" : "border-transparent text-[#65768a]"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "audit" && <SscasnAuditWorkspace adminPassword={adminPassword} />}
      {tab !== "audit" && data.isLoading && (
        <p className="flex items-center gap-2 py-12 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat SSCASN…
        </p>
      )}
      {tab !== "audit" && data.isError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {data.error.message}
        </div>
      )}
      {tab !== "audit" && result && (
        <>
          <div
            className={`border-l-4 p-3 text-sm ${result.mode === "local" ? "border-amber-400 bg-amber-50 text-amber-900" : "border-emerald-500 bg-emerald-50 text-emerald-900"}`}
          >
            <span className="font-semibold">
              {result.mode === "local" ? "Database lokal" : "Database Supabase"}
            </span>
            {result.snapshot.scope_institution && (
              <span> · {result.snapshot.scope_institution}</span>
            )}
            {result.mode === "local" && (
              <span> · Review tersimpan di komputer ini; belum diterapkan pada hasil publik.</span>
            )}
            <span className="mt-1 block text-xs">
              Diambil {new Date(result.snapshot.captured_at).toLocaleDateString("id-ID")} · Pelamar
              = lulus administrasi, bukan peserta hadir SKD.
            </span>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[#dbe3ee] bg-[#dbe3ee] xl:grid-cols-4">
            <Metric label="Formasi" value={number(result.snapshot.row_count)} />
            <Metric label="Instansi" value={number(result.institutions.length)} />
            <Metric label="Kuota" value={number(result.snapshot.quota_total)} />
            <Metric
              label="Pelamar lulus administrasi"
              value={number(result.snapshot.passed_admin_total)}
            />
          </div>
          {tab === "catalog" ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold">
                  Instansi
                  <select
                    className="desk-input mt-1"
                    value={institution}
                    onChange={(event) => {
                      setInstitution(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Semua instansi</option>
                    {result.institutions.map((row) => (
                      <option key={row.institution} value={row.institution}>
                        {row.institution} ({number(row.row_count)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold">
                  Jabatan, lokasi, atau pendidikan
                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-[#8291a3]" />
                    <input
                      className="desk-input !pl-9"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Cari formasi"
                    />
                  </div>
                </label>
              </div>
              <div className="overflow-x-auto rounded-md border border-[#dbe3ee] bg-white">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-[#edf2f7] text-[#536579]">
                    <tr>
                      {[
                        "Jabatan / instansi",
                        "Pendidikan / lokasi",
                        "Kuota",
                        "Pelamar",
                        "Rasio administrasi",
                      ].map((label) => (
                        <th key={label} className="p-3 font-semibold">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.formations.map((row) => (
                      <tr key={row.source_id} className="border-t border-[#e2e8f0] align-top">
                        <td className="max-w-[280px] p-3">
                          <p className="font-semibold">{row.job}</p>
                          <p className="mt-1 text-[#65768a]">{row.institution}</p>
                        </td>
                        <td className="max-w-[380px] p-3">
                          <p className="line-clamp-3" title={row.education}>
                            {row.education}
                          </p>
                          <p className="mt-1 text-[#65768a]">{row.location}</p>
                        </td>
                        <td className="p-3 font-mono">{number(row.quota)}</td>
                        <td className="p-3 font-mono">{number(row.passed_admin)}</td>
                        <td className="p-3 font-mono">
                          {row.quota > 0
                            ? `${(row.passed_admin / row.quota).toLocaleString("id-ID", { maximumFractionDigits: 1 })}x`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!result.formations.length && (
                  <p className="p-8 text-center text-sm text-[#65768a]">Formasi tidak ditemukan.</p>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-[#65768a]">
                <span>
                  {number(result.pagination.total)} formasi · Halaman {page}/
                  {result.pagination.total_pages}
                </span>
                <div className="flex gap-2">
                  <button
                    title="Halaman sebelumnya"
                    aria-label="Halaman sebelumnya"
                    className="desk-icon-button"
                    disabled={page === 1 || data.isFetching}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    title="Halaman berikutnya"
                    aria-label="Halaman berikutnya"
                    className="desk-icon-button"
                    disabled={page >= result.pagination.total_pages || data.isFetching}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  {approved} disetujui · {pending} belum diperiksa
                </span>
                <select
                  aria-label="Status pencocokan"
                  className="desk-input !w-auto"
                  value={reviewFilter}
                  onChange={(event) => setReviewFilter(event.target.value)}
                >
                  <option value="pending">Belum diperiksa</option>
                  <option value="approved">Disetujui</option>
                  <option value="rejected">Ditolak</option>
                  <option value="unmatched">Belum ada kandidat</option>
                  <option value="all">Semua</option>
                </select>
              </div>
              <div className="divide-y divide-[#dbe3ee] border-y border-[#dbe3ee]">
                {rows.map((row) => (
                  <ReviewRow
                    key={row.pdf.id}
                    row={row}
                    snapshot={result.snapshot}
                    password={adminPassword}
                    onSaved={() => data.refetch()}
                  />
                ))}
                {!rows.length && (
                  <p className="py-10 text-center text-sm text-[#65768a]">
                    Tidak ada pencocokan dengan status ini.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white p-4">
      <p className="text-xs text-[#65768a]">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold">{value}</p>
    </div>
  );
}

function ReviewRow({
  row,
  snapshot,
  password,
  onSaved,
}: {
  row: SscasnReviewRow;
  snapshot: SscasnSnapshot;
  password: string;
  onSaved: () => void;
}) {
  const [sourceId, setSourceId] = useState(
    row.match?.source_id ?? row.candidates[0]?.formation.source_id ?? "",
  );
  const [notes, setNotes] = useState(row.match?.notes ?? "");
  const candidate = row.candidates.find((item) => item.formation.source_id === sourceId);
  const save = useMutation({
    mutationFn: (review_status: "approved" | "rejected" | "pending") =>
      saveAdminSscasnMatch(password, {
        formation_id: row.pdf.id,
        snapshot_id: snapshot.id,
        source_id: sourceId,
        review_status,
        notes,
      }),
    onSuccess: () => {
      toast.success("Review pasangan tersimpan.");
      onSaved();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <article className="py-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{row.pdf.jabatan}</h2>
        <span
          className={`text-xs font-semibold ${row.match?.review_status === "approved" ? "text-emerald-700" : "text-[#65768a]"}`}
        >
          {STATUS[row.match?.review_status ?? "pending"]}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1 text-xs leading-5">
          <p className="font-semibold text-[#0d6cbd]">
            PDF SKD · Halaman {row.pdf.page_number ?? "—"}
          </p>
          <p>
            {row.pdf.jenis_formasi} · Kuota {row.pdf.jumlah_formasi}
          </p>
          <p>{row.pdf.pendidikan}</p>
          <p className="text-[#65768a]">{row.pdf.lokasi_formasi}</p>
        </div>
        <div className="min-w-0 space-y-2 text-xs leading-5">
          <label className="block font-semibold">
            Pasangan SSCASN
            <select
              className="desk-input mt-1 text-xs"
              aria-label={`Pasangan SSCASN ${row.pdf.jabatan} ${row.pdf.jenis_formasi}`}
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              disabled={!row.candidates.length}
            >
              {!row.candidates.length && (
                <option value="">Belum ada kandidat jabatan yang sama</option>
              )}
              {row.candidates.map((item) => (
                <option key={item.formation.source_id} value={item.formation.source_id}>
                  {item.exact ? "Cocok semua kolom" : item.differences.join(", ")} · Kuota{" "}
                  {item.formation.quota} · {item.formation.passed_admin} pelamar ·{" "}
                  {item.formation.source_id.slice(-8)}
                </option>
              ))}
            </select>
          </label>
          {candidate && (
            <>
              <p>{candidate.formation.education}</p>
              <p className="text-[#65768a]">{candidate.formation.location}</p>
              <p className="text-amber-800">
                Jenis formasi tidak tercantum pada daftar API; periksa kelompok PDF sebelum
                menyetujui.
              </p>
            </>
          )}
          <label className="block">
            Catatan review
            {candidate && !candidate.exact && " (wajib untuk pasangan berbeda kolom)"}
            <input
              className="desk-input mt-1 text-xs"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={1000}
              placeholder="Catatan pencocokan"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#20795d] px-3 font-semibold text-white disabled:opacity-40"
              disabled={!candidate || save.isPending || (!candidate.exact && !notes.trim())}
              onClick={() => save.mutate("approved")}
            >
              <Check className="h-4 w-4" />
              Setujui pasangan
            </button>
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#dbe3ee] px-3 font-semibold disabled:opacity-40"
              disabled={!candidate || save.isPending}
              onClick={() => save.mutate("rejected")}
            >
              <X className="h-4 w-4" />
              Tolak
            </button>
            {row.match && (
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#dbe3ee] px-3 font-semibold disabled:opacity-40"
                disabled={!candidate || save.isPending}
                onClick={() => save.mutate("pending")}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Periksa ulang
              </button>
            )}
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin self-center" />}
          </div>
        </div>
      </div>
    </article>
  );
}
