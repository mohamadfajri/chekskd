import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Calculator, Search } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { LoginGate } from "@/components/public/LoginGate";
import { SkdCoverageNote } from "@/components/public/SkdCoverageNote";
import { cleanFormationId } from "@/lib/formationSelection";
import {
  MANUAL_SKD_FIELDS,
  MANUAL_SKD_MAX,
  manualSkdScore,
  type ManualSkdField,
  type ManualSkdResult,
  type ManualSkdTarget,
} from "@/lib/manualSkd";
import { getCurrentAccount } from "@/services/authService";
import { getFormationFilterOptions } from "@/services/formationService";

export const Route = createFileRoute("/simulasi-skd")({
  validateSearch: (search: Record<string, unknown>): { targetFormationId?: string } => ({
    targetFormationId: cleanFormationId(search.targetFormationId),
  }),
  head: () => ({ meta: [{ title: "Simulasi Nilai SKD 2024 - AnalisaCPNS" }] }),
  component: ManualSkdPage,
});

const field =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const button =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/manual-skd", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || "Simulasi belum tersedia.");
  return data;
}

function ManualSkdPage() {
  const { targetFormationId } = Route.useSearch();
  const account = useQuery({
    queryKey: ["current-account"],
    queryFn: getCurrentAccount,
    staleTime: 60_000,
    retry: false,
  });
  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="public-workspace">
        <nav
          aria-label="Sumber nilai"
          className="flex gap-4 border-b border-border text-sm font-semibold"
        >
          <Link
            to="/search"
            search={{ targetFormationId }}
            className="py-3 text-muted-foreground hover:text-primary"
          >
            Cari nilai saya
          </Link>
          <Link
            to="/simulasi-skd"
            search={{ targetFormationId }}
            aria-current="page"
            className="border-b-2 border-primary py-3 text-primary"
          >
            Masukkan nilai sendiri
          </Link>
        </nav>
        <header className="my-6">
          <p className="public-kicker font-mono">CPNS 2024 · FORMASI UMUM</p>
          <h1 className="mt-2 text-3xl font-bold">Simulasi nilai SKD</h1>
        </header>
        <SkdCoverageNote className="mb-4 max-w-4xl" />
        {account.isPending ? (
          <p role="status">Memeriksa akses…</p>
        ) : account.isError ? (
          <button type="button" className={button} onClick={() => void account.refetch()}>
            Coba lagi
          </button>
        ) : account.data ? (
          <ManualSkdForm key={targetFormationId ?? "manual"} initialTargetId={targetFormationId} />
        ) : (
          <LoginGate
            next={
              targetFormationId
                ? `/simulasi-skd?targetFormationId=${targetFormationId}`
                : "/simulasi-skd"
            }
            title="Masuk untuk simulasi nilai"
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function ManualSkdForm({ initialTargetId }: { initialTargetId?: string }) {
  const [values, setValues] = useState<Record<ManualSkdField, string>>({
    twk: "",
    tiu: "",
    tkp: "",
  });
  const [education, setEducation] = useState("");
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState("");
  const [preferredId, setPreferredId] = useState(initialTargetId);
  const score = manualSkdScore(
    Object.fromEntries(
      MANUAL_SKD_FIELDS.map((key) => [key, values[key] === "" ? null : Number(values[key])]),
    ),
  );
  const filters = useQuery({
    queryKey: ["formation-filter-options"],
    queryFn: getFormationFilterOptions,
    staleTime: 30 * 60_000,
  });
  const targets = useMutation({
    mutationFn: (input: { education: string; query: string; targetId?: string }) =>
      request<{ targets: ManualSkdTarget[] }>({ action: "targets", ...input }),
    onSuccess: ({ targets }, input) => {
      if (input.targetId && targets[0]?.id === input.targetId) setTargetId(input.targetId);
    },
  });
  const simulation = useMutation({
    mutationFn: (input: {
      education: string;
      targetId: string;
      twk: number;
      tiu: number;
      tkp: number;
    }) => request<{ result: ManualSkdResult }>({ action: "simulate", ...input }),
  });
  const busy = targets.isPending || simulation.isPending;

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setTargetId("");
          simulation.reset();
          targets.mutate({
            education: education.trim(),
            query: query.trim(),
            targetId: preferredId,
          });
        }}
        className="max-w-4xl space-y-5 border-y border-border py-5"
      >
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-4">
          {MANUAL_SKD_FIELDS.map((key) => (
            <label key={key} className="grid min-w-0 gap-1 text-sm font-semibold">
              {key.toUpperCase()}
              <input
                type="number"
                min={0}
                max={MANUAL_SKD_MAX[key]}
                step={1}
                required
                disabled={busy}
                inputMode="numeric"
                className={field}
                value={values[key]}
                onChange={(event) => {
                  setValues({ ...values, [key]: event.target.value });
                  simulation.reset();
                }}
              />
            </label>
          ))}
          <div className="grid gap-1 text-sm font-semibold">
            <label htmlFor="manual-total">Total</label>
            <output
              id="manual-total"
              className="flex h-10 items-center text-xl tabular-nums text-primary"
            >
              {score?.total ?? "—"}
            </output>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">
            Pendidikan
            <input
              list="manual-education"
              className={field}
              value={education}
              required
              maxLength={160}
              disabled={busy}
              onChange={(event) => {
                setEducation(event.target.value);
                setTargetId("");
                targets.reset();
                simulation.reset();
              }}
              placeholder="Contoh: S-1 Hukum"
            />
          </label>
          <datalist id="manual-education">
            {filters.data?.education_options.map((option) => (
              <option key={option.value} value={option.value} />
            ))}
          </datalist>
          {preferredId ? (
            <div className="self-end text-sm">
              <span className="text-muted-foreground">Target dipilih dari daftar formasi.</span>{" "}
              <button
                type="button"
                disabled={busy}
                className="min-h-10 font-semibold text-primary hover:underline"
                onClick={() => {
                  setPreferredId(undefined);
                  setTargetId("");
                  targets.reset();
                  simulation.reset();
                }}
              >
                Ganti target
              </button>
            </div>
          ) : (
            <label className="grid gap-1 text-sm font-semibold">
              Cari instansi atau jabatan
              <input
                className={field}
                value={query}
                disabled={busy}
                maxLength={120}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
        </div>
        <button className={button} disabled={!score || !education.trim() || busy}>
          <Search className="size-4" aria-hidden />{" "}
          {targets.isPending ? "Mencari…" : "Cari formasi pembanding"}
        </button>
      </form>

      {targets.isError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {targets.error.message}
        </p>
      )}
      {targets.data &&
        (targets.data.targets.length ? (
          <form
            className="my-5 flex max-w-4xl flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (score && targetId)
                simulation.mutate({ education: education.trim(), targetId, ...score });
            }}
          >
            <label className="grid min-w-0 flex-1 basis-64 gap-1 text-sm font-semibold">
              Formasi tujuan
              <select
                className={field}
                value={targetId}
                required
                disabled={busy}
                onChange={(event) => {
                  setTargetId(event.target.value);
                  simulation.reset();
                }}
              >
                <option value="">Pilih formasi</option>
                {targets.data.targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.job} · {target.institution}
                    {target.location ? ` · ${target.location}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button className={button} disabled={!score || !targetId || busy}>
              <Calculator className="size-4" aria-hidden />{" "}
              {simulation.isPending ? "Menghitung…" : "Hitung posisi"}
            </button>
          </form>
        ) : (
          <div className="my-5 max-w-4xl border-b border-border pb-4 text-sm">
            <p role="status">Tidak ada formasi dengan pendidikan dan data SKD yang sesuai.</p>
            <Link
              to="/formasi"
              search={{ tampilan: "katalog" }}
              className="mt-2 inline-block font-semibold text-primary hover:underline"
            >
              Lihat katalog formasi
            </Link>
          </div>
        ))}
      {simulation.isError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {simulation.error.message}
        </p>
      )}
      {simulation.data && <ManualResult result={simulation.data.result} />}
    </>
  );
}

function ManualResult({ result }: { result: ManualSkdResult }) {
  const { target, score, rank, ties, scoreGap, belowThreshold } = result;
  return (
    <section aria-live="polite" className="my-6 max-w-4xl border-y border-border py-5">
      <p className="public-kicker font-mono">SIMULASI HISTORIS · NILAI INPUT MANUAL</p>
      <h2 className="mt-2 break-words text-lg font-bold">{target.job}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {target.institution} · {target.matchedEducation}
      </p>
      <dl className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Nilai kamu", score.total],
            ["Batas historis", target.cutoff],
            ["Selisih nilai", scoreGap > 0 ? `+${scoreGap}` : scoreGap],
            ["Posisi simulasi", rank ?? "—"],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {rank === null ? (
        <p className="text-sm">
          Belum mencapai ambang batas UMUM 2024 pada {belowThreshold.join(", ").toUpperCase()}.
          Posisi tidak dihitung.
        </p>
      ) : (
        <p className="text-sm">
          Kuota {target.quota} · Kapasitas lanjut SKB historis {target.shortlistCapacity}
          {ties ? ` · ${ties} peserta dengan skor identik` : ""}.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Perbandingan dengan peserta historis, bukan hasil resmi atau jaminan kelulusan.
      </p>
    </section>
  );
}
