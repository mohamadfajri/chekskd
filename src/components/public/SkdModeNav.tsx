import { Link } from "@tanstack/react-router";
import { PenLine, Search } from "lucide-react";

export function SkdModeNav({
  mode,
  targetFormationId,
}: {
  mode: "search" | "manual";
  targetFormationId?: string;
}) {
  return (
    <nav aria-label="Sumber nilai" className="skd-mode-nav">
      <Link
        to="/search"
        search={{ targetFormationId }}
        aria-current={mode === "search" ? "page" : undefined}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span>Cari nama saya</span>
      </Link>
      <Link
        to="/simulasi-skd"
        search={{ targetFormationId }}
        aria-current={mode === "manual" ? "page" : undefined}
      >
        <PenLine className="size-4 shrink-0" aria-hidden />
        <span>Masukkan nilai sendiri</span>
      </Link>
    </nav>
  );
}
