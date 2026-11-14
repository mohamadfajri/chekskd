import { Link } from "@tanstack/react-router";
import { ClipboardCheck, Search } from "lucide-react";

export function SkdModeNav({
  mode,
  targetFormationId,
}: {
  mode: "skd" | "tryout";
  targetFormationId?: string;
}) {
  return (
    <>
      <header className="mx-auto mb-5 max-w-2xl text-center">
        <h1 className="text-2xl font-bold sm:text-3xl">Nilaimu cocok untuk formasi mana?</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Bandingkan nilai SKD lama atau skor tryout dengan hasil peserta <strong>CPNS 2024</strong>{" "}
          sebagai bahan memilih formasi 2026.
        </p>
      </header>
      <nav aria-label="Sumber nilai" className="skd-mode-nav">
        <Link
          to="/search"
          search={{ targetFormationId }}
          aria-current={mode === "skd" ? "page" : undefined}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span>Pakai nilai SKD 2024</span>
        </Link>
        <Link
          to="/simulasi-skd"
          search={{ targetFormationId }}
          aria-current={mode === "tryout" ? "page" : undefined}
        >
          <ClipboardCheck className="size-4 shrink-0" aria-hidden />
          <span>Pakai skor tryout</span>
        </Link>
      </nav>
    </>
  );
}
