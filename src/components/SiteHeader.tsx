import { Link } from "@tanstack/react-router";
import { ListFilter, Search } from "lucide-react";
import { AnalisaCPNSLogo } from "@/components/brand/AnalisaCPNSLogo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="AnalisaCPNS - beranda">
          <AnalisaCPNSLogo size={39} className="hidden sm:block" />
          <AnalisaCPNSLogo variant="icon" size={36} className="sm:hidden" />
        </Link>

        <nav aria-label="Navigasi utama" className="flex items-center gap-1 text-sm">
          <Link
            to="/"
            hash="cara-kerja"
            className="hidden rounded-md px-3 py-2 font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground md:inline-flex"
          >
            Cara kerja
          </Link>
          <Link
            to="/formasi"
            className="inline-flex h-9 items-center gap-2 rounded-md px-2.5 font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground sm:px-3"
          >
            <ListFilter className="h-4 w-4" />
            <span className="hidden sm:inline">Formasi</span>
          </Link>
          <Link
            to="/search"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 font-semibold text-white transition hover:bg-[#255de8]"
          >
            <Search className="h-4 w-4" />
            Cek posisi
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[#193451] bg-[#071b36] text-white">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <AnalisaCPNSLogo theme="dark" size={40} />
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#a9b9cb]">
            Alat bantu untuk memahami posisi nilai SKD berdasarkan data pengumuman instansi yang
            telah dipublikasikan. Hasil analisis bukan pengumuman resmi dan tidak menjamin
            kelulusan.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#a9b9cb]">
          <Link to="/search" className="hover:text-white">
            Cari data
          </Link>
          <Link to="/formasi" className="hover:text-white">
            Jelajahi formasi
          </Link>
          <Link to="/" hash="cara-kerja" className="hover:text-white">
            Cara kerja
          </Link>
          <span className="font-mono text-xs">analisacpns.id</span>
        </div>
      </div>
    </footer>
  );
}
