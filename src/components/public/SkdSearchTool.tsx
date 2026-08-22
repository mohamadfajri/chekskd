import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileSearch,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { isSupabaseConfigured, supabaseConfigError } from "@/lib/supabase/client";
import { maskNoPeserta } from "@/lib/analysis";
import { MIN_NAME_SEARCH_LENGTH } from "@/lib/skdSearch";
import { searchSkdScores } from "@/services/skdService";

type SearchMode = "name" | "participant";

export function SkdSearchTool({
  compact = false,
  targetFormationId,
}: {
  compact?: boolean;
  targetFormationId?: string;
}) {
  const [mode, setMode] = useState<SearchMode>("name");
  const [nama, setNama] = useState("");
  const [noPeserta, setNoPeserta] = useState("");
  const [instansi, setInstansi] = useState("");
  const [formasi, setFormasi] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => searchSkdScores({ nama, no_peserta: noPeserta, instansi, formasi }),
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
    if (canSearch) mutation.mutate();
  }

  return (
    <div className="w-full">
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

      <form onSubmit={onSubmit} className="border-y border-border bg-white py-5 sm:py-6">
        <div className="flex flex-col gap-4">
          <div className="flex w-fit rounded-lg border border-border bg-muted p-1" role="tablist">
            <ModeButton active={mode === "name"} onClick={() => changeMode("name")}>
              Nama peserta
            </ModeButton>
            <ModeButton active={mode === "participant"} onClick={() => changeMode("participant")}>
              Nomor peserta
            </ModeButton>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-xs font-semibold text-foreground">
                {mode === "name" ? "Cari nama pada data SKD" : "Masukkan nomor peserta"}
              </span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={mode === "name" ? nama : noPeserta}
                  onChange={(event) =>
                    mode === "name" ? setNama(event.target.value) : setNoPeserta(event.target.value)
                  }
                  placeholder={
                    mode === "name" ? "Contoh: Fadila Bijaksana" : "Masukkan minimal 6 angka"
                  }
                  autoComplete="off"
                  className="h-12 w-full rounded-lg border border-input bg-white pl-10 pr-4 text-sm font-medium text-foreground shadow-sm transition placeholder:font-normal placeholder:text-[#8292a5] focus:border-primary"
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={!canSearch || mutation.isPending}
              className="mt-auto inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-bold text-white transition hover:bg-[#255de8] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Cari data SKD
            </button>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              className="inline-flex items-center gap-2 rounded-md py-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Persempit dengan instansi atau formasi
              {filtersOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>

            {filtersOpen && (
              <div className="mt-3 grid gap-3 border-l-2 border-[#dce8ff] pl-4 sm:grid-cols-2">
                <FilterField
                  label="Instansi"
                  value={instansi}
                  onChange={setInstansi}
                  placeholder="Contoh: Kejaksaan Agung"
                />
                <FilterField
                  label="Formasi atau jabatan"
                  value={formasi}
                  onChange={setFormasi}
                  placeholder="Contoh: Analis Hukum"
                />
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Data historis SKD 2024 dari pengumuman instansi. Nama dapat dicari sebagian, minimal{" "}
            {MIN_NAME_SEARCH_LENGTH} karakter.
          </p>
        </div>
      </form>

      <div aria-live="polite" className={compact ? "mt-6" : "mt-8"}>
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
              Periksa ejaan, coba sebagian nama, atau kosongkan filter instansi dan formasi untuk
              memperluas hasil.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <section aria-labelledby="search-result-title">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase text-primary">
                  Hasil pencarian
                </p>
                <h2 id="search-result-title" className="mt-1 text-lg font-bold">
                  {results.length} data cocok
                </h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Pilih data yang benar-benar milik Anda.
              </p>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-white">
              {results.map((result, index) => (
                <SearchResultRow
                  key={result.id}
                  result={result}
                  first={index === 0}
                  targetFormationId={targetFormationId}
                />
              ))}
            </div>
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-8 rounded-md px-3 text-xs font-semibold transition ${
        active
          ? "bg-white text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function FilterField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm transition placeholder:text-[#8a9aac] focus:border-primary"
      />
    </label>
  );
}

function SearchResultRow({
  result,
  first,
  targetFormationId,
}: {
  result: Awaited<ReturnType<typeof searchSkdScores>>[number];
  first: boolean;
  targetFormationId?: string;
}) {
  const formation = result.skd_formations;

  return (
    <article className={`${first ? "" : "border-t border-border"} p-4 sm:p-5`}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold sm:text-base">{result.nama}</h3>
            <span className="rounded-sm bg-muted px-2 py-1 font-mono text-[9px] font-semibold text-muted-foreground">
              DATA {result.tahun_skd ?? 2024}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {maskNoPeserta(result.no_peserta)} · halaman {result.source_page ?? "-"}
          </p>
          <p className="mt-3 text-sm font-semibold text-foreground">
            {formation?.jabatan ?? "Formasi belum teridentifikasi"}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {formation?.nama_instansi ?? "Instansi belum teridentifikasi"}
          </p>
        </div>

        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-border bg-muted/60">
          {[
            ["TWK", result.twk],
            ["TIU", result.tiu],
            ["TKP", result.tkp],
            ["Total", result.total],
          ].map(([label, value], index) => (
            <div
              key={String(label)}
              className={`${index ? "border-l border-border" : ""} px-2 py-2.5 text-center`}
            >
              <p className="text-[9px] font-semibold uppercase text-muted-foreground">{label}</p>
              <p
                className={`mt-0.5 font-mono text-sm font-semibold ${index === 3 ? "text-primary" : ""}`}
              >
                {value ?? "-"}
              </p>
            </div>
          ))}
        </div>

        <Link
          to="/result/$scoreId"
          params={{ scoreId: result.id }}
          search={{ targetFormationId }}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-[#071b36] px-4 text-xs font-bold text-white transition hover:bg-[#11365f]"
        >
          Ini data saya
        </Link>
      </div>
    </article>
  );
}
