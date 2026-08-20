import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Clock3, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { buildWhatsAppUrl } from "@/lib/analysis";

export const Route = createFileRoute("/wa/$token")({
  head: () => ({
    meta: [
      { title: "Kode Analisis Siap - AnalisaCPNS" },
      {
        name: "description",
        content: "Kirim kode AnalisaCPNS melalui WhatsApp untuk memulai rasionalisasi.",
      },
    ],
  }),
  component: WaRedirectPage,
});

function WaRedirectPage() {
  const { token } = Route.useParams();
  const whatsappUrl = buildWhatsAppUrl(token);

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      toast.success("Kode disalin");
    } catch {
      toast.error("Kode belum dapat disalin. Tekan dan tahan kode untuk menyalin.");
    }
  }

  return (
    <div className="min-h-screen bg-muted">
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 py-10 sm:px-6 sm:py-14">
        <div className="text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-[#e8f7f1] text-[#16805c]">
            <Check className="h-6 w-6" />
          </span>
          <p className="mt-5 font-mono text-[10px] font-semibold uppercase text-primary">
            Permintaan tersimpan
          </p>
          <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Lanjutkan di WhatsApp</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Kirim pesan yang sudah disiapkan. Analisis baru dimulai setelah kode diterima oleh bot
            AnalisaCPNS.
          </p>
        </div>

        <section className="mt-8 overflow-hidden rounded-lg border border-border bg-white shadow-lg shadow-[#071b36]/5">
          <div className="border-b border-border px-5 py-5 text-center sm:px-8">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              Kode analisis
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <span className="break-all font-mono text-xl font-semibold text-primary sm:text-2xl">
                {token}
              </span>
              <button
                type="button"
                onClick={copyToken}
                title="Salin kode"
                aria-label="Salin kode"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="p-5 sm:p-8">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#16805c] px-5 text-sm font-bold text-white transition hover:bg-[#116b4d]"
            >
              <MessageCircle className="h-4 w-4" />
              Buka WhatsApp dan kirim kode
            </a>

            <div className="mt-7">
              <p className="text-xs font-bold">Apa yang terjadi setelah dikirim?</p>
              <div className="mt-4 grid gap-0 sm:grid-cols-3">
                <ProcessStep
                  number="01"
                  title="Kode diterima"
                  description="Bot mengenali data Anda."
                />
                <ProcessStep
                  number="02"
                  title="Nilai dianalisis"
                  description="Target dan posisi dihitung."
                  bordered
                />
                <ProcessStep
                  number="03"
                  title="Kartu dikirim"
                  description="Satu gambar masuk ke chat."
                  bordered
                />
              </div>
            </div>

            <div className="mt-6 flex items-start gap-3 border-l-2 border-[#b56a00] bg-[#fff8ec] px-4 py-3 text-xs leading-5 text-[#81500e]">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Hasil dikirim maksimal 10 menit dan biasanya selesai lebih cepat. Tidak perlu
                mengirim kode berulang kali selama proses berjalan.
              </span>
            </div>
          </div>
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-muted-foreground">
          <Link to="/search" className="hover:text-foreground">
            Cari peserta lain
          </Link>
          <Link to="/" className="hover:text-foreground">
            Kembali ke beranda
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function ProcessStep({
  number,
  title,
  description,
  bordered = false,
}: {
  number: string;
  title: string;
  description: string;
  bordered?: boolean;
}) {
  return (
    <div
      className={`${bordered ? "border-t border-border pt-4 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0" : ""} pb-4 sm:pr-4`}
    >
      <span className="font-mono text-[9px] font-semibold text-primary">{number}</span>
      <p className="mt-1 text-xs font-bold">{title}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{description}</p>
    </div>
  );
}
