import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { HomeJourney } from "@/components/public/HomeJourney";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="home-workspace">
        <header className="home-intro">
          <p className="home-eyebrow">AnalisaCPNS &mdash; Analisis Nilai &amp; Formasi Gratis</p>
          <h1>
            Seberapa Besar Peluangmu <span>di CPNS Berikutnya?</span>
          </h1>
          <p className="home-intro-copy">
            Cek nilai SKD lama, bandingkan skor tryout dan pesaing, lalu temukan formasi yang paling
            sesuai dengan nilaimu.
          </p>
        </header>
        <HomeJourney />
        <section className="home-bot" aria-labelledby="home-bot-title">
          <h2 id="home-bot-title">
            Coba Bot Rasionalisasi <span>Nilai SKD &amp; Tryout?</span>
          </h2>
          <div className="home-bot-channels">
            {botChannels.map(({ label, channel, href }) => {
              const content = (
                <>
                  <BotChannelIcon channel={channel} />
                  {label}
                  {href && <ArrowUpRight className="size-4" aria-hidden />}
                </>
              );
              const className = "home-bot-channel";
              return href ? (
                <a key={channel} href={href} data-channel={channel} className={className}>
                  {content}
                </a>
              ) : (
                <button
                  key={channel}
                  type="button"
                  data-channel={channel}
                  className={className}
                  disabled
                >
                  {content}
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

type BotChannel = "whatsapp" | "telegram";

const botChannels: { channel: BotChannel; label: string; href?: string }[] = [
  { channel: "whatsapp", label: "WhatsApp" },
  { channel: "telegram", label: "Telegram" },
];

function BotChannelIcon({ channel }: { channel: BotChannel }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5 shrink-0" aria-hidden="true">
      {channel === "whatsapp" ? (
        <path d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.2-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.8-1.8-.9-.2-.1-.4-.1-.6.2l-.8 1c-.2.1-.3.1-.6 0a6.3 6.3 0 0 1-3.1-2.7c-.1-.3 0-.4.1-.5l.4-.5c.1-.2.2-.3.2-.4l-.1-.4-.8-1.9c-.2-.4-.3-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.9.9-.9 2.1 0 1.3.9 2.5 1 2.7.1.2 1.8 2.7 4.3 3.7 1.6.7 2.2.6 3 .5.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.3-.2-.5-.3Z" />
      ) : (
        <path d="M21.7 3.4 18.4 20c-.2 1.2-.9 1.5-1.9.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.4-8.5c.4-.4-.1-.6-.6-.3L5.7 13.4l-5-1.6c-1.1-.4-1.1-1.1.2-1.6L20.3 2.7c.9-.3 1.6.2 1.4.7Z" />
      )}
    </svg>
  );
}
