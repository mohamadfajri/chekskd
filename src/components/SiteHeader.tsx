import { useEffect, useState, type ComponentType } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  Home,
  ListFilter,
  LogIn,
  Search,
  UserRound,
} from "lucide-react";
import { AnalisaCPNSLogo } from "@/components/brand/AnalisaCPNSLogo";
import { getCurrentAccount } from "@/services/authService";

type NavItem = {
  label: string;
  shortLabel: string;
  to: "/" | "/search" | "/formasi" | "/formasi/banding";
  icon: ComponentType<{ className?: string }>;
  hash?: string;
  search?: { ids?: string };
  matches: (path: string) => boolean;
};

const navItems: NavItem[] = [
  {
    label: "Beranda",
    shortLabel: "Beranda",
    to: "/",
    icon: Home,
    matches: (path) => path === "/",
  },
  {
    label: "Cek nilai",
    shortLabel: "Cek",
    to: "/search",
    icon: Search,
    matches: (path) =>
      path === "/search" ||
      path === "/simulasi-skd" ||
      path.startsWith("/result/") ||
      path.startsWith("/wa/"),
  },
  {
    label: "Formasi",
    shortLabel: "Formasi",
    to: "/formasi",
    icon: ListFilter,
    matches: (path) =>
      path === "/formasi" || (path.startsWith("/formasi/") && path !== "/formasi/banding"),
  },
  {
    label: "Bandingkan",
    shortLabel: "Banding",
    to: "/formasi/banding",
    search: { ids: undefined },
    icon: ChartNoAxesCombined,
    matches: (path) => path === "/formasi/banding",
  },
  {
    label: "Metode",
    shortLabel: "Metode",
    to: "/",
    hash: "cara-kerja",
    icon: BookOpen,
    matches: () => false,
  },
];

export function SiteHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [scrolled, setScrolled] = useState(false);

  const account = useQuery({
    queryKey: ["current-account"],
    queryFn: getCurrentAccount,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 90);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <>
      <header className={`public-nav-shell ${scrolled ? "is-scrolled" : ""}`}>
        <div className="public-nav">
          <Link to="/" aria-label="AnalisaCPNS - beranda" className="public-nav-brand">
            <AnalisaCPNSLogo theme="dark" bareMark size={38} className="public-nav-logo-full" />
            <AnalisaCPNSLogo variant="icon" bareMark size={36} className="public-nav-logo-icon" />
          </Link>

          <nav aria-label="Navigasi utama" className="public-nav-tabs">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.matches(pathname);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  key={`${item.to}-${item.label}`}
                  to={item.to}
                  hash={item.hash}
                  search={item.search}
                  className={`public-nav-tab ${active ? "is-active" : ""}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="public-nav-label">{item.label}</span>
                  <span className="public-nav-label-short">{item.shortLabel}</span>
                </Link>
              );
            })}
          </nav>

          <div className="public-nav-tail">
            <Link
              to={account.data ? "/akun" : "/login"}
              search={account.data ? undefined : { next: "/akun" }}
              className={`public-account-button ${pathname === "/akun" || pathname === "/login" ? "is-active" : ""}`}
              aria-label={account.data ? "Buka akun" : "Masuk atau daftar"}
              title={account.data ? "Akun" : "Masuk"}
            >
              {account.data ? <UserRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              <span>{account.data ? "Akun" : "Masuk"}</span>
            </Link>
            <Link
              to="/search"
              search={{ targetFormationId: undefined }}
              aria-label="Cari peserta"
              className="public-primary-button public-nav-cta"
            >
              <span>Cari peserta</span>
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>
      <div className="public-nav-spacer" aria-hidden="true" />
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="public-footer">
      <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <AnalisaCPNSLogo theme="dark" size={40} />
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/75">
            Alat bantu untuk memahami posisi nilai SKD dari pengumuman instansi yang telah
            dipublikasikan. Hasil analisis bukan pengumuman resmi dan tidak menjamin kelulusan.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-white/75">
          <Link to="/search" className="transition hover:text-white">
            Cari data
          </Link>
          <Link to="/formasi" className="transition hover:text-white">
            Jelajahi formasi
          </Link>
          <Link to="/" hash="cara-kerja" className="transition hover:text-white">
            Metodologi
          </Link>
          <span className="font-mono text-xs text-white">analisacpns.id</span>
        </div>
      </div>
    </footer>
  );
}
