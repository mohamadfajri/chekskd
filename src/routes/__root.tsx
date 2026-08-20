import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs font-semibold text-primary">ERROR 404</p>
        <h1 className="mt-3 text-3xl font-bold">Halaman tidak ditemukan</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Alamat ini tidak tersedia atau sudah dipindahkan.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[#255de8]"
        >
          Kembali ke pencarian
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs font-semibold text-destructive">SISTEM TERHENTI</p>
        <h1 className="mt-3 text-2xl font-bold">Halaman gagal dimuat</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Coba muat ulang. Data yang sudah Anda isi tetap aman di halaman sebelumnya.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[#255de8]"
          >
            Muat ulang
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-semibold transition hover:bg-muted"
          >
            Ke pencarian
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AnalisaCPNS - Cek Posisi Nilai SKD" },
      {
        name: "description",
        content:
          "Cari data SKD, pahami posisi nilai, dan bandingkan persaingan formasi berdasarkan data historis.",
      },
      { name: "author", content: "AnalisaCPNS by Mimin CPNS" },
      { property: "og:title", content: "AnalisaCPNS - Nilai menjadi posisi" },
      {
        property: "og:description",
        content:
          "Cari data SKD, pahami posisi nilai, dan bandingkan persaingan formasi berdasarkan data historis.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/og-analisa-cpns.svg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "AnalisaCPNS - Nilai menjadi posisi" },
      {
        name: "twitter:description",
        content:
          "Cari data SKD, pahami posisi nilai, dan bandingkan persaingan formasi berdasarkan data historis.",
      },
      { name: "twitter:image", content: "/og-analisa-cpns.svg" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
