import { Link } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-gradient text-primary-foreground">
            <GraduationCap className="h-4 w-4" />
          </span>
          <span className="text-sm sm:text-base">
            cpnsguru.id{" "}
            <span className="text-muted-foreground font-normal">· Cek Rasionalisasi SKD</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/search"
            className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cari Data
          </Link>
          <Link
            to="/"
            hash="cara-kerja"
            className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-block"
          >
            Cara Kerja
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 bg-muted/40">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">cpnsguru.id</p>
        <p className="mt-1 max-w-2xl">
          Hasil analisa di situs ini bersifat edukatif dan bukan pengumuman resmi. Data bersumber
          dari pengumuman instansi yang telah dipublikasikan.
        </p>
        <p className="mt-4 text-xs">© {new Date().getFullYear()} cpnsguru.id</p>
      </div>
    </footer>
  );
}
