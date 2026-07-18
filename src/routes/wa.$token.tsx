import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, MessageCircle, Copy } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import { buildWhatsAppUrl } from "@/lib/analysis";
import { toast } from "sonner";

export const Route = createFileRoute("/wa/$token")({
  head: () => ({
    meta: [
      { title: "Kode Hasil Siap — cpnsguru.id" },
      { name: "description", content: "Kirim kode hasil ke Assistant cpnsguru.id lewat WhatsApp." },
    ],
  }),
  component: WaRedirectPage,
});

function WaRedirectPage() {
  const { token } = Route.useParams();
  const waUrl = buildWhatsAppUrl(token);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold">Kode Hasil Kamu Sudah Siap</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Klik tombol di bawah untuk membuka WhatsApp dan kirim kode hasil ke Assistant
            cpnsguru.id.
          </p>

          <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-brand-soft px-4 py-4">
            <span className="font-mono text-2xl font-bold tracking-widest text-primary">
              {token}
            </span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(token);
                toast.success("Kode disalin");
              }}
              className="ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-white hover:text-foreground"
              aria-label="Salin kode"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>

          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
          >
            <MessageCircle className="h-4 w-4" />
            Lihat Hasil Lengkap via WhatsApp
          </a>

          <p className="mt-4 text-xs text-muted-foreground">
            Setelah membuka WhatsApp, tekan kirim. Assistant kami akan membalas dengan analisa
            lengkap.
          </p>
        </div>

        <div className="mt-6 text-center text-sm">
          <Link to="/search" className="text-muted-foreground hover:text-foreground">
            ← Cari data peserta lain
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
