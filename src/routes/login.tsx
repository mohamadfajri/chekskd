import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import {
  loginAccount,
  pollAuthChallenge,
  registerAccount,
  requestPasswordReset,
  type AuthChallenge,
} from "@/services/authService";

type AuthMode = "login" | "register" | "reset";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    next:
      typeof search.next === "string" &&
      search.next.startsWith("/") &&
      !search.next.startsWith("//")
        ? search.next
        : "/akun",
  }),
  head: () => ({
    meta: [
      { title: "Masuk - AnalisaCPNS" },
      {
        name: "description",
        content: "Masuk atau buat akun AnalisaCPNS menggunakan nomor WhatsApp.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<AuthMode>("login");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const login = useMutation({
    mutationFn: loginAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["current-account"] });
      window.location.assign(next);
    },
    onError: (error) => toast.error(error.message),
  });
  const register = useMutation({
    mutationFn: registerAccount,
    onSuccess: setChallenge,
    onError: (error) => toast.error(error.message),
  });
  const reset = useMutation({
    mutationFn: requestPasswordReset,
    onSuccess: setChallenge,
    onError: (error) => toast.error(error.message),
  });

  const verification = useQuery({
    queryKey: ["auth-challenge", challenge?.challenge_id, challenge?.poll_token],
    queryFn: () => pollAuthChallenge(challenge!),
    enabled: Boolean(challenge),
    refetchInterval: (query) => (query.state.data?.status === "verified" ? false : 2_000),
    retry: false,
  });

  useEffect(() => {
    if (verification.data?.status !== "verified") return;
    queryClient.setQueryData(["current-account"], verification.data.user ?? null);
    toast.success(
      mode === "reset" ? "Password berhasil diperbarui." : "WhatsApp berhasil diverifikasi.",
    );
    window.location.assign(next);
  }, [mode, next, queryClient, verification.data]);

  useEffect(() => {
    if (!challenge) return;
    const update = () => {
      setSecondsLeft(
        Math.max(0, Math.ceil((new Date(challenge.expires_at).getTime() - Date.now()) / 1_000)),
      );
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "login") login.mutate({ whatsapp, password });
    else if (mode === "register") {
      register.mutate({ whatsapp, password, marketing_opt_in: marketingOptIn });
    } else reset.mutate({ whatsapp, new_password: password });
  };

  const switchMode = (value: AuthMode) => {
    setMode(value);
    setPassword("");
    setChallenge(null);
    queryClient.removeQueries({ queryKey: ["auth-challenge"] });
  };

  const pending = login.isPending || register.isPending || reset.isPending;

  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="public-workspace auth-workspace">
        <section className="auth-shell">
          <div className="auth-context-panel">
            <div>
              <p className="font-mono">IDENTITAS AKUN</p>
              <h1>Satu nomor untuk akses AnalisaCPNS.</h1>
              <p>
                Nomor WhatsApp menjadi identitas akun. Password tetap di website dan verifikasi
                dilakukan melalui bot yang sama dengan hasil rasionalisasi.
              </p>
            </div>
            <div className="auth-route-map" aria-label="Alur verifikasi akun">
              <AuthRouteStep icon={Smartphone} number="01" label="Nomor + password" />
              <AuthRouteStep icon={MessageCircle} number="02" label="Kirim kode ke bot" />
              <AuthRouteStep icon={ShieldCheck} number="03" label="Akun terverifikasi" />
            </div>
            <div className="auth-context-note">
              <LockKeyhole className="h-4 w-4" />
              <span>Password tidak pernah dikirim melalui WhatsApp.</span>
            </div>
          </div>

          <div className="auth-form-panel">
            {challenge ? (
              <VerificationPanel
                challenge={challenge}
                secondsLeft={secondsLeft}
                checking={verification.isFetching}
                error={verification.error?.message}
                onCancel={() => setChallenge(null)}
              />
            ) : (
              <>
                <div className="auth-mode-switch" role="tablist" aria-label="Pilihan akun">
                  <ModeButton active={mode === "login"} onClick={() => switchMode("login")}>
                    Masuk
                  </ModeButton>
                  <ModeButton active={mode === "register"} onClick={() => switchMode("register")}>
                    Daftar
                  </ModeButton>
                  <ModeButton active={mode === "reset"} onClick={() => switchMode("reset")}>
                    Lupa password
                  </ModeButton>
                </div>

                <header className="auth-form-heading">
                  <span className="auth-heading-icon">
                    {mode === "login" ? (
                      <KeyRound className="h-5 w-5" />
                    ) : (
                      <ShieldCheck className="h-5 w-5" />
                    )}
                  </span>
                  <div>
                    <p className="font-mono">
                      {mode === "login"
                        ? "AKUN TERDAFTAR"
                        : mode === "register"
                          ? "AKUN BARU"
                          : "PULIHKAN AKUN"}
                    </p>
                    <h2>
                      {mode === "login"
                        ? "Masuk ke akunmu"
                        : mode === "register"
                          ? "Daftar melalui WhatsApp"
                          : "Buat password baru"}
                    </h2>
                  </div>
                </header>

                <form onSubmit={submit} className="auth-form">
                  <label>
                    <span>Nomor WhatsApp</span>
                    <div className="auth-input-wrap">
                      <span className="font-mono">+62</span>
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={whatsapp}
                        onChange={(event) => setWhatsapp(event.target.value)}
                        placeholder="0822 6550 7384"
                        required
                      />
                    </div>
                  </label>

                  <label>
                    <span>{mode === "reset" ? "Password baru" : "Password"}</span>
                    <div className="auth-input-wrap auth-password-input">
                      <LockKeyhole className="h-4 w-4" />
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Minimal 8 karakter, huruf dan angka"
                        minLength={8}
                        required
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                        title={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                        onClick={() => setShowPassword((current) => !current)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </label>

                  {mode === "register" ? (
                    <label className="auth-consent-row">
                      <input
                        type="checkbox"
                        checked={marketingOptIn}
                        onChange={(event) => setMarketingOptIn(event.target.checked)}
                      />
                      <span>
                        Saya bersedia menerima informasi CPNS dan promo tryout melalui WhatsApp.
                        Pilihan ini tidak wajib.
                      </span>
                    </label>
                  ) : null}

                  <button type="submit" className="auth-submit" disabled={pending}>
                    {pending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : mode === "login" ? (
                      <KeyRound className="h-4 w-4" />
                    ) : (
                      <MessageCircle className="h-4 w-4" />
                    )}
                    <span>
                      {mode === "login"
                        ? "Masuk"
                        : mode === "register"
                          ? "Buat kode verifikasi"
                          : "Verifikasi password baru"}
                    </span>
                    {!pending ? <ArrowRight className="h-4 w-4" /> : null}
                  </button>
                </form>
              </>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}>
      {children}
    </button>
  );
}

function AuthRouteStep({
  icon: Icon,
  number,
  label,
}: {
  icon: typeof Smartphone;
  number: string;
  label: string;
}) {
  return (
    <div>
      <span>
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <small className="font-mono">{number}</small>
        <strong>{label}</strong>
      </div>
    </div>
  );
}

function VerificationPanel({
  challenge,
  secondsLeft,
  checking,
  error,
  onCancel,
}: {
  challenge: AuthChallenge;
  secondsLeft: number;
  checking: boolean;
  error?: string;
  onCancel: () => void;
}) {
  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");
  return (
    <div className="auth-verification">
      <span className="auth-heading-icon">
        <MessageCircle className="h-5 w-5" />
      </span>
      <p className="font-mono">VERIFIKASI WHATSAPP</p>
      <h2>Kirim kode dari nomor yang didaftarkan</h2>
      <p>Pesan sudah disiapkan. Jangan mengubah isi teks ketika WhatsApp terbuka.</p>
      <div className="auth-code-block">
        <small className="font-mono">KODE SEKALI PAKAI</small>
        <strong className="font-mono">{challenge.code}</strong>
        <span className="font-mono">
          {secondsLeft > 0 ? `${minutes}:${seconds}` : "KEDALUWARSA"}
        </span>
      </div>
      <a
        href={challenge.whatsapp_url}
        target="_blank"
        rel="noreferrer"
        className="auth-submit"
        aria-disabled={secondsLeft <= 0}
      >
        <MessageCircle className="h-4 w-4" />
        <span>Buka WhatsApp dan kirim</span>
        <ArrowRight className="h-4 w-4" />
      </a>
      <div className={`auth-poll-state ${error ? "is-error" : ""}`} aria-live="polite">
        {error ? (
          <span>{error}</span>
        ) : (
          <>
            {checking ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            <span>Menunggu konfirmasi dari bot Hermes...</span>
          </>
        )}
      </div>
      <button type="button" onClick={onCancel} className="auth-text-button">
        Kembali ke formulir
      </button>
    </div>
  );
}
