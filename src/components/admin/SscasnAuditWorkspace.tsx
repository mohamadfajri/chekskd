import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Loader2, ScanSearch, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SSCASN_AUDIT_LABELS,
  SSCASN_MANUAL_BATCH_LIMIT,
  SSCASN_MANUAL_NOTE_MIN,
  type SscasnAuditResponse,
  type SscasnManualSelection,
} from "@/lib/sscasnReconciliation";
import {
  approveAdminSscasnAudit,
  approveAdminSscasnSelection,
  getAdminSscasnAudit,
  getAdminSscasnAuditInstitutions,
} from "@/services/sscasnService";

const number = new Intl.NumberFormat("id-ID");
const approveButton =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-[#20795d] px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#20795d] disabled:opacity-40";

export function SscasnAuditWorkspace({ adminPassword }: { adminPassword: string }) {
  const queryClient = useQueryClient();
  const [institution, setInstitution] = useState("");
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<SscasnManualSelection[] | null>(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<{ institution: string; count: number } | null>(null);
  const selections = Object.entries(selected).map(([formationId, sourceId]) => ({
    formationId,
    sourceId,
  }));
  const selectedSources = new Map(
    selections.map(({ formationId, sourceId }) => [sourceId, formationId]),
  );
  const auditKey = (name: string, index: number) =>
    ["admin-sscasn-audit", adminPassword, name, index] as const;
  const institutions = useQuery({
    queryKey: ["admin-sscasn-audit-institutions", adminPassword],
    queryFn: () => getAdminSscasnAuditInstitutions(adminPassword),
    staleTime: 60_000,
  });
  const audit = useQuery({
    queryKey: auditKey(active, page),
    queryFn: () => getAdminSscasnAudit(adminPassword, { institution: active, page }),
    enabled: Boolean(active),
    staleTime: 30_000,
  });
  function showResult(result: SscasnAuditResponse) {
    void queryClient.invalidateQueries({
      queryKey: ["admin-sscasn-audit", adminPassword, result.institution],
      refetchType: "none",
    });
    void queryClient.invalidateQueries({ queryKey: ["admin-sscasn", adminPassword] });
    void queryClient.invalidateQueries({ queryKey: ["formation-catalog"] });
    queryClient.setQueryData(auditKey(result.institution, result.pagination.page), result);
    setActive(result.institution);
    setPage(result.pagination.page);
    setNotice({ institution: result.institution, count: result.newlyApproved ?? 0 });
  }
  const run = useMutation({
    mutationFn: (name: string) => approveAdminSscasnAudit(adminPassword, name),
    onSuccess: (result) => {
      showResult(result);
      setSelected({});
    },
  });
  const save = useMutation({
    mutationFn: (pairs: SscasnManualSelection[]) =>
      approveAdminSscasnSelection(adminPassword, {
        institution: active,
        selections: pairs,
        note,
        page,
      }),
    onSuccess: (result, pairs) => {
      showResult(result);
      const saved = new Set(pairs.map(({ formationId }) => formationId));
      setSelected((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => !saved.has(id))),
      );
      setDraft(null);
    },
  });
  const result = audit.data;

  function startApproval(pairs: SscasnManualSelection[]) {
    save.reset();
    setNote("");
    setDraft(pairs);
  }

  function selectPair(formationId: string, sourceId?: string) {
    setSelected((current) => {
      if (
        sourceId &&
        Object.entries(current).some(([id, source]) => id !== formationId && source === sourceId)
      )
        return current;
      if (sourceId) {
        if (!current[formationId] && Object.keys(current).length >= SSCASN_MANUAL_BATCH_LIMIT)
          return current;
        return { ...current, [formationId]: sourceId };
      }
      const next = { ...current };
      delete next[formationId];
      return next;
    });
  }

  return (
    <section className="space-y-4" aria-label="Audit pencocokan SSCASN">
      <form
        className="flex flex-wrap items-end gap-3 border-b border-[#dbe3ee] pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (institution && !run.isPending) run.mutate(institution);
        }}
      >
        <label className="grid min-w-0 flex-[1_1_18rem] gap-1 text-xs font-semibold sm:max-w-lg">
          Instansi SKD 2024
          <select
            className="desk-input min-w-0"
            value={institution}
            disabled={!institutions.data?.institutions.length || run.isPending}
            onChange={(event) => {
              setInstitution(event.target.value);
              run.reset();
            }}
          >
            <option value="">
              {institutions.isPending ? "Memuat instansi..." : "Pilih instansi"}
            </option>
            {institutions.data?.institutions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!institution || run.isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#0d6cbd] px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0d6cbd] disabled:opacity-50"
        >
          {run.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ScanSearch className="size-4" aria-hidden />
          )}
          {run.isPending ? "Mengaudit..." : "Audit dan setujui"}
        </button>
      </form>
      {institutions.isError && (
        <p role="alert" className="text-sm text-red-800">
          {institutions.error.message}{" "}
          <button
            type="button"
            onClick={() => void institutions.refetch()}
            className="font-semibold underline"
          >
            Coba lagi
          </button>
        </p>
      )}
      {institutions.data?.institutions.length === 0 && (
        <p className="text-sm text-[#536579]">Belum ada instansi dengan hasil SKD 2024 terbit.</p>
      )}
      {run.isError && (
        <p role="alert" className="text-sm text-red-800">
          {run.error.message}
        </p>
      )}
      {active && audit.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Memuat hasil audit...
        </p>
      )}
      {audit.isError && (
        <p role="alert" className="text-sm text-red-800">
          {audit.error.message}{" "}
          <button
            type="button"
            onClick={() => void audit.refetch()}
            className="font-semibold underline"
          >
            Coba lagi
          </button>
        </p>
      )}
      {result && (
        <>
          <div>
            <h2 className="break-words text-base font-semibold">{result.institution}</h2>
            <p className="mt-1 text-xs text-[#536579]">
              Aesen 2024 dibandingkan dengan data SKD terverifikasi. Angka nol memerlukan bukti
              rekap PDF dan API detail yang sudah disimpan.
            </p>
          </div>
          {notice?.institution === result.institution && (
            <p role="status" className="text-sm font-medium text-emerald-800">
              {notice.count
                ? `${number.format(notice.count)} pasangan baru disetujui.`
                : "Tidak ada pasangan baru yang disetujui."}
            </p>
          )}
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-[#dbe3ee] bg-[#dbe3ee]">
            {(
              [
                ["Formasi SKD", result.summary.total],
                ["Perlu review", result.summary.review],
                ["Disetujui", result.summary.alreadyApproved],
              ] as const
            ).map(([label, value]) => (
              <div className="min-w-0 bg-white p-3" key={label}>
                <dt className="text-xs text-[#536579]">{label}</dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                  {number.format(value)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Perlu review</h3>
            <p className="text-xs text-[#536579]" aria-live="polite">
              {number.format(result.pagination.total)} formasi
            </p>
          </div>
          {selections.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 border-y border-[#dbe3ee] bg-white px-3 py-2 text-sm"
              aria-label="Pilihan persetujuan"
            >
              <span aria-live="polite" className="mr-auto font-medium tabular-nums">
                {selections.length}/{SSCASN_MANUAL_BATCH_LIMIT} dipilih
              </span>
              <button
                type="button"
                title="Kosongkan pilihan"
                aria-label="Kosongkan pilihan"
                className="desk-icon-button"
                onClick={() => setSelected({})}
              >
                <X className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className={approveButton}
                disabled={run.isPending || save.isPending}
                onClick={() => startApproval(selections)}
              >
                <Check className="size-4" aria-hidden /> Setujui pilihan
              </button>
            </div>
          )}
          {result.rows.length ? (
            <ul className="divide-y divide-[#dbe3ee] border-y border-[#dbe3ee]">
              {result.rows.map((row) => (
                <AuditRow
                  key={row.id}
                  row={row}
                  selectedSource={selected[row.id]}
                  selectedSources={selectedSources}
                  limitReached={selections.length >= SSCASN_MANUAL_BATCH_LIMIT}
                  busy={run.isPending || save.isPending}
                  onSelect={(sourceId) => selectPair(row.id, sourceId)}
                  onApprove={(sourceId) => startApproval([{ formationId: row.id, sourceId }])}
                />
              ))}
            </ul>
          ) : (
            <p className="border-y border-[#dbe3ee] py-8 text-center text-sm text-[#536579]">
              Tidak ada formasi yang perlu review.
            </p>
          )}
          {result.pagination.totalPages > 1 && (
            <nav
              aria-label="Halaman audit"
              className="flex items-center justify-end gap-2 text-xs tabular-nums"
            >
              <button
                type="button"
                className="desk-icon-button"
                aria-label="Halaman audit sebelumnya"
                disabled={result.pagination.page <= 1 || audit.isFetching}
                onClick={() => setPage(result.pagination.page - 1)}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <span>
                {result.pagination.page} / {result.pagination.totalPages}
              </span>
              <button
                type="button"
                className="desk-icon-button"
                aria-label="Halaman audit berikutnya"
                disabled={
                  result.pagination.page >= result.pagination.totalPages || audit.isFetching
                }
                onClick={() => setPage(result.pagination.page + 1)}
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </nav>
          )}
        </>
      )}
      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setDraft(null);
        }}
      >
        <DialogContent className="w-[calc(100%_-_2rem)] max-w-lg rounded-lg bg-white">
          <DialogTitle>Setujui {draft?.length ?? 0} pasangan</DialogTitle>
          <DialogDescription>
            Catat bukti dari PDF asli untuk semua pasangan ini. Pasangan yang disetujui keluar dari
            antrean review.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft?.length && note.trim().length >= SSCASN_MANUAL_NOTE_MIN && !save.isPending)
                save.mutate(draft);
            }}
          >
            <label className="grid gap-1 text-sm font-medium">
              Catatan bukti PDF
              <textarea
                rows={3}
                required
                minLength={SSCASN_MANUAL_NOTE_MIN}
                maxLength={700}
                className="w-full min-w-0 resize-y rounded-md border border-input px-3 py-2 text-sm"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={save.isPending}
              />
            </label>
            {save.isError && (
              <p role="alert" className="text-sm text-red-800">
                {save.error.message}
              </p>
            )}
            <DialogFooter className="gap-2">
              <button
                type="button"
                className="min-h-9 rounded-md border border-input px-3 text-sm font-semibold"
                disabled={save.isPending}
                onClick={() => setDraft(null)}
              >
                Batal
              </button>
              <button
                type="submit"
                className={approveButton}
                disabled={
                  !draft?.length || note.trim().length < SSCASN_MANUAL_NOTE_MIN || save.isPending
                }
              >
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                {save.isPending ? "Menyimpan..." : "Konfirmasi persetujuan"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AuditRow({
  row,
  selectedSource,
  selectedSources,
  limitReached,
  busy,
  onSelect,
  onApprove,
}: {
  row: SscasnAuditResponse["rows"][number];
  selectedSource?: string;
  selectedSources: ReadonlyMap<string, string>;
  limitReached: boolean;
  busy: boolean;
  onSelect: (sourceId?: string) => void;
  onApprove: (sourceId: string) => void;
}) {
  const [choice, setChoice] = useState("");
  const allowed = row.candidates.filter(
    ({ row: candidate, canApprove }) =>
      canApprove &&
      (!selectedSources.has(candidate.id) || selectedSources.get(candidate.id) === row.id),
  );
  const explicit = selectedSource || choice;
  const candidateId =
    allowed.find(({ row: candidate }) => candidate.id === explicit)?.row.id ??
    (allowed.length === 1 ? allowed[0].row.id : "");
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="grid items-start gap-1 sm:grid-cols-[minmax(0,1fr)_12rem] sm:gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold">{row.job}</p>
          <p className="mt-1 break-words text-xs text-[#536579]">
            PDF halaman {row.page ?? "-"}
            {row.category ? ` · ${row.category}` : ""} · Kuota {number.format(row.quota)}
          </p>
        </div>
        <span className="text-xs font-semibold text-amber-900">
          {SSCASN_AUDIT_LABELS[row.status]}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex min-h-9 items-center gap-2 text-xs font-semibold text-[#536579]">
          <input
            type="checkbox"
            className="size-4 accent-[#0d6cbd]"
            checked={Boolean(selectedSource)}
            aria-label={`Pilih formasi ${row.job}, halaman ${row.page ?? "tidak diketahui"}`}
            disabled={busy || (!selectedSource && (!candidateId || limitReached))}
            onChange={(event) => onSelect(event.target.checked ? candidateId : undefined)}
          />{" "}
          Pilih
        </label>
        {allowed.length > 1 && (
          <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold">
            Kandidat Aesen
            <select
              className="desk-input !w-auto max-w-full"
              value={candidateId}
              disabled={busy}
              onChange={(event) => {
                const id = event.target.value;
                setChoice(id);
                if (selectedSource) onSelect(id || undefined);
              }}
            >
              <option value="">Pilih ID kandidat</option>
              {allowed.map(({ row: candidate }) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id.slice(-8)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className={approveButton}
          disabled={!candidateId || busy}
          onClick={() => onApprove(candidateId)}
        >
          <Check className="size-4" aria-hidden /> Setujui
        </button>
      </div>
      <details className="text-xs">
        <summary className="w-fit cursor-pointer py-1 font-semibold text-[#0d6cbd]">
          Bandingkan data
        </summary>
        <div className="mt-2 grid gap-3 border-t border-[#dbe3ee] pt-3 sm:grid-cols-2">
          <Evidence label="PDF SKD" row={row} countLabel="Peserta terdaftar" />
          {row.candidates.length ? (
            <div className="min-w-0 space-y-3">
              {row.candidates.map(({ row: candidate, differences, canApprove }) => (
                <div key={candidate.id} className="min-w-0 space-y-1">
                  <Evidence
                    label={`Aesen · ${candidate.id.slice(-8)}`}
                    row={candidate}
                    countLabel="Lolos administrasi"
                  />
                  {differences.length > 0 && (
                    <p className="break-words font-medium text-amber-900">
                      Berbeda: {differences.join(", ")}
                    </p>
                  )}
                  {!canApprove && (
                    <p className="text-[#536579]">Bukti belum memenuhi syarat persetujuan.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[#536579]">Tidak ada kandidat pembanding di katalog instansi ini.</p>
          )}
        </div>
      </details>
    </li>
  );
}

function Evidence({
  label,
  row,
  countLabel,
}: {
  label: string;
  row: Pick<
    SscasnAuditResponse["rows"][number],
    "job" | "location" | "education" | "quota" | "registered"
  > & { category?: string | null };
  countLabel: string;
}) {
  return (
    <div className="min-w-0 space-y-1 break-words leading-5">
      <p className="font-semibold">{label}</p>
      <p>{row.job}</p>
      <p className="text-[#536579]">Kategori: {row.category || "Belum tersedia"}</p>
      <p className="text-[#536579]">Lokasi: {row.location || "Tidak tercantum"}</p>
      <p className="text-[#536579]">Pendidikan: {row.education || "Tidak tercantum"}</p>
      <p className="tabular-nums">
        Kuota {number.format(row.quota)} · {countLabel} {number.format(row.registered)}
      </p>
    </div>
  );
}
