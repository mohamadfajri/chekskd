import { createFileRoute } from "@tanstack/react-router";
import { FormationCatalog } from "@/components/public/FormationCatalog";
import {
  catalogCompetition,
  catalogLevel,
  catalogSort,
  type CatalogLevel,
} from "@/lib/formationCatalog";
import { parseFormationIds, serializeFormationIds } from "@/lib/formationSelection";
import type { FormationCompetitionLevel, FormationSort } from "@/services/formationService";

interface FormationPageSearch {
  banding?: string;
  tampilan?: "katalog" | "skd";
  skd?: boolean;
  lingkup?: CatalogLevel;
  halaman?: number;
  q?: string;
  jabatan?: string;
  instansi?: string;
  pendidikan?: string;
  jenis?: string;
  persaingan?: FormationCompetitionLevel;
  urut?: FormationSort;
}

function searchText(value: unknown, maximum = 160): string | undefined {
  return typeof value === "string" && value.trim() && value.trim().length <= maximum
    ? value.trim()
    : undefined;
}

export const Route = createFileRoute("/formasi/")({
  validateSearch: (search: Record<string, unknown>): FormationPageSearch => ({
    banding: serializeFormationIds(parseFormationIds(search.banding)),
    tampilan:
      search.tampilan === "katalog" || search.tampilan === "skd" ? search.tampilan : undefined,
    skd: search.skd === true ? true : undefined,
    lingkup: catalogLevel(search.lingkup),
    halaman:
      typeof search.halaman === "number" &&
      Number.isSafeInteger(search.halaman) &&
      search.halaman > 1
        ? search.halaman
        : undefined,
    q: searchText(search.q, 120),
    jabatan: searchText(search.jabatan, 240),
    instansi: searchText(search.instansi),
    pendidikan: searchText(search.pendidikan),
    jenis: searchText(search.jenis, 80),
    persaingan: catalogCompetition(search.persaingan),
    urut: catalogSort(search.urut),
  }),
  head: () => ({
    meta: [
      { title: "Jelajahi Formasi CPNS - AnalisaCPNS" },
      {
        name: "description",
        content:
          "Cari formasi, kuota, dan kisaran gaji historis CPNS serta bandingkan data SKD terverifikasi.",
      },
    ],
  }),
  component: FormationIndexPage,
});

function FormationIndexPage() {
  const {
    banding,
    q,
    jabatan,
    instansi,
    pendidikan,
    jenis,
    persaingan,
    urut,
    tampilan,
    lingkup,
    halaman,
    skd,
  } = Route.useSearch();
  return (
    <main>
      <FormationCatalog
        initialComparisonIds={parseFormationIds(banding)}
        filters={{
          query: q,
          job: jabatan,
          institution: instansi,
          education: pendidikan,
          level: lingkup,
          page: halaman,
          hasSkd: skd || tampilan === "skd",
          formationType: jenis,
          competitionLevel: persaingan,
          sort: urut,
        }}
      />
    </main>
  );
}
