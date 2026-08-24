import { Link } from "@tanstack/react-router";
import { ArrowRight, LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";

export function LoginGate({
  next,
  title = "Masuk untuk membuka analisis lengkap",
  description = "Verifikasi satu kali melalui WhatsApp, lalu lanjutkan dari halaman ini.",
  compact = false,
}: {
  next: string;
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <section className={`public-login-gate ${compact ? "is-compact" : ""}`}>
      <div className="public-login-gate-icon">
        <LockKeyhole className="h-5 w-5" />
      </div>
      <div className="public-login-gate-copy">
        <p className="font-mono">AKSES AKUN</p>
        <h2>{title}</h2>
        <p>{description}</p>
        <div>
          <span>
            <ShieldCheck className="h-3.5 w-3.5" /> Nomor terverifikasi
          </span>
          <span>
            <MessageCircle className="h-3.5 w-3.5" /> Satu akun WhatsApp
          </span>
        </div>
      </div>
      <Link to="/login" search={{ next }} className="public-login-gate-action">
        <span>Masuk atau daftar</span>
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}
