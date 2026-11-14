import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowUpRight, ChevronDown, FileSearch, Loader2, Search } from "lucide-react";
import { isSupabaseConfigured, supabaseConfigError } from "@/lib/supabase/client";
import { maskNoPeserta } from "@/lib/analysis";
import { MIN_NAME_SEARCH_LENGTH } from "@/lib/skdSearch";
import { getSkdSearchInstitutions, searchSkdScores } from "@/services/skdService";

type SearchMode = "name" | "participant";

export function SkdSearchTool({ targetFormationId }: { targetFormationId?: string }) {
  const [mode, setMode] = useState<SearchMode>("name");
  const [nama, setNama] = useState("");
  const [noPeserta, setNoPeserta] = useState("");
  const [instansi, setInstansi] = useState("");
  const institutions = useQuery({
    queryKey: ["skd-search-institutions"],
    queryFn: getSkdSearchInstitutions,
    enabled: isSupabaseConfigured,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: () =>
      searchSkdScores({
        nama: mode === "name" ? nama : "",
        no_peserta: mode === "participant" ? noPeserta : undefined,
        instansi,
      }),
  });

  const canSearch =
    isSupabaseConfigured &&
    (mode === "name" ? nama.trim().length >= MIN_NAME_SEARCH_LENGTH : noPeserta.trim().length >= 6);
  const results = mutation.data ?? [];
  const searchError = mutation.isError ? (mutation.error as Error).message : "";
  const friendlyError = searchError.toLowerCase().includes("statement timeout")
    ? "Pencarian terlalu luas untuk diselesaikan. Tambahkan filter instansi atau gunakan nomor peserta."
    : searchError;

  function changeMode(nextMode: SearchMode) {
    setMode(nextMode);
    mutation.reset();
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (canSearch && !mutation.isPending) mutation.mutate();
  }

  return (
    <div className="skd-search-tool w-full">
      {!isSupabaseConfigured && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Pencarian belum tersedia</p>
            <p className="mt-1 text-xs">
              {supabaseConfigError ?? "Koneksi basis data belum dikonfigurasi."}
            </p>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="skd-search-form border-y border-border py-3 sm:py-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label="Jenis pencarian">
            <ModeButton active={mode === "name"} onClick={() => changeMode("name")}>
              Nama peserta
            </ModeButton>
            <ModeButton active={mode === "participant"} onClick={() => changeMode("participant")}>
              Nomor peserta
            </ModeButton>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_auto] sm:gap-3">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-semibold text-foreground">
                {mode === "name" ? "Nama lengkap atau sebagian" : "Nomor peserta"}
              </span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={mode === "name" ? nama : noPeserta}
                  onChange={(event) =>
                    mode === "name" ? setNama(event.target.value) : setNoPeserta(event.target.value)
                  }
                  placeholder={mode === "name" ? "Nama peserta" : "Masukkan minimal 6 angka"}
                  inputMode={mode === "participant" ? "numeric" : undefined}
                  autoComplete="off"
                  className="h-12 w-full rounded-lg border border-input bg-white pl-10 pr-4 text-sm font-medium text-foreground shadow-sm transition placeholder:font-normal placeholder:text-[#8292a5] focus:border-primary"
                />
              </div>
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-semibold text-foreground">Instansi</span>
              <div className="relative">
                <select
                  value={instansi}
                  onChange={(event) => {
                    setInstansi(event.target.value);
                    mutation.reset();
                  }}
                  disabled={mutation.isPending || !institutions.data?.length}
                  className="h-12 w-full appearance-none truncate rounded-lg border border-input bg-white pl-3 pr-9 text-sm text-foreground shadow-sm disabled:text-muted-foreground"
                >
                  <option value="">
                    {institutions.isLoading
                      ? "Memuat instansi..."
                      : institutions.isSuccess && !institutions.data.length
                        ? "Belum ada instansi SKD"
                        : "Semua instansi"}
                  </option>
                  {institutions.data?.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={!canSearch || mutation.isPending}
              className="skd-search-submit mt-auto inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-45"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {mutation.isPending ? "Mencari..." : "Cari data SKD"}
            </button>
          </div>

          {institutions.isError && (
            <p className="text-xs text-muted-foreground" role="status">
              Daftar instansi belum dapat dimuat.{" "}
              <button
                type="button"
                onClick={() => void institutions.refetch()}
                className="font-semibold text-primary hover:underline"
              >
                Coba lagi
              </button>
            </p>
          )}
        </div>
      </form>

      <div aria-live="polite" aria-busy={mutation.isPending} className="mt-4 sm:mt-6">
        {mutation.isError && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#8f3039]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Pencarian belum berhasil</p>
              <p className="mt-1 text-xs">{friendlyError}</p>
            </div>
          </div>
        )}

        {mutation.isSuccess && results.length === 0 && (
          <div className="border-y border-dashed border-border py-10 text-center">
            <FileSearch className="mx-auto h-9 w-9 text-[#8ca0b7]" />
            <h2 className="mt-3 text-base font-bold">Data belum ditemukan</h2>
            <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
              Periksa ejaan atau pilih Semua instansi untuk memperluas pencarian.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <section aria-labelledby="search-result-title">
            <h2 id="search-result-title" className="mb-3 text-base font-bold">
              {results.length} hasil pencarian
            </h2>
            <div className="hidden rounded-lg border border-border bg-white md:block">
              <table className="w-full table-fixed text-left" aria-labelledby="search-result-title">
                <thead className="border-b border-border bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-[26%] px-3 py-3">
                      Peserta
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Formasi dan instansi
                    </th>
                    {scoreFields.map(({ label }) => (
                      <th scope="col" key={label} className="w-[7%] px-1 py-3 text-center">
                        {label}
                      </th>
                    ))}
                    <th scope="col" className="w-[132px] px-2 py-3">
                      <span className="sr-only">Pilih peserta</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.map((result) => (
                    <tr key={result.id} className="hover:bg-muted/30">
                      <th scope="row" className="px-3 py-3 align-middle">
                        <Participant result={result} />
                      </th>
                      <td className="px-3 py-3">
                        <Formation result={result} />
                      </td>
                      {scoreFields.map(({ field, label }) => (
                        <td
                          key={field}
                          className={`px-1 py-3 text-center font-mono text-sm ${label === "Total" ? "font-bold text-primary" : ""}`}
                        >
                          {result[field] ?? "-"}
                        </td>
                      ))}
                      <td className="px-2 py-3 text-right">
                        <SelectResult result={result} targetFormationId={targetFormationId} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border border-y border-border md:hidden">
              {results.map((result) => (
                <SearchResultRow
                  key={result.id}
                  result={result}
                  targetFormationId={targetFormationId}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 border-b-2 px-1 text-xs font-semibold transition ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

type SearchResult = Awaited<ReturnType<typeof searchSkdScores>>[number];

const scoreFields = [
  { field: "twk", label: "TWK" },
  { field: "tiu", label: "TIU" },
  { field: "tkp", label: "TKP" },
  { field: "total", label: "Total" },
] as const;

function Participant({ result }: { result: SearchResult }) {
  return (
    <>
      <span className="block text-sm font-bold [overflow-wrap:anywhere]">{result.nama}</span>
      <span className="mt-1 block font-mono text-xs font-normal text-muted-foreground">
        {maskNoPeserta(result.no_peserta)}
        {result.source_page != null && ` · hal. ${result.source_page}`}
      </span>
    </>
  );
}

function Formation({ result }: { result: SearchResult }) {
  const formation = result.skd_formations;

  return (
    <>
      <span className="block text-sm font-semibold [overflow-wrap:anywhere]">
        {formation?.jabatan ?? "Formasi belum teridentifikasi"}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {formation?.nama_instansi ?? "Instansi belum teridentifikasi"}
      </span>
    </>
  );
}

function SelectResult({
  result,
  targetFormationId,
}: {
  result: SearchResult;
  targetFormationId?: string;
}) {
  return (
    <Link
      to="/result/$scoreId"
      params={{ scoreId: result.id }}
      search={{ targetFormationId }}
      aria-label={`Ini data saya: ${result.nama}`}
      className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-primary/25 px-2 text-xs font-bold text-primary transition hover:border-primary/50 hover:bg-primary/5 md:min-h-9"
    >
      Ini data saya
      <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
    </Link>
  );
}

function SearchResultRow({
  result,
  targetFormationId,
}: {
  result: SearchResult;
  targetFormationId?: string;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-x-2 gap-y-1 py-2">
      <div className="min-w-0 leading-snug">
        <Participant result={result} />
      </div>
      <Link
        to="/result/$scoreId"
        params={{ scoreId: result.id }}
        search={{ targetFormationId }}
        aria-label={`Ini data saya: ${result.nama}`}
        title="Ini data saya"
        className="grid size-11 place-items-center rounded-lg border border-primary/25 text-primary hover:bg-primary/5"
      >
        <ArrowUpRight className="size-4" aria-hidden />
      </Link>
      <p className="col-span-2 line-clamp-2 text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">
        <span className="font-semibold text-foreground">
          {result.skd_formations?.jabatan ?? "Formasi belum teridentifikasi"}
        </span>
        {result.skd_formations?.nama_instansi && ` · ${result.skd_formations.nama_instansi}`}
      </p>
      <dl className="col-span-2 flex flex-wrap gap-x-3 gap-y-1">
        {scoreFields.map(({ field, label }) => (
          <div key={field} className="flex items-baseline gap-1">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd
              className={`font-mono text-xs font-bold ${field === "total" ? "text-primary" : ""}`}
            >
              {result[field] ?? "-"}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
