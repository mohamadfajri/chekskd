import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LogOut,
  MessageCircle,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import {
  deleteAccount,
  getCurrentAccount,
  logoutAccount,
  maskAccountWhatsapp,
  updateAccount,
} from "@/services/authService";

export const Route = createFileRoute("/akun")({
  head: () => ({
    meta: [
      { title: "Akun - AnalisaCPNS" },
      { name: "description", content: "Kelola akun WhatsApp AnalisaCPNS." },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: ["current-account"],
    queryFn: getCurrentAccount,
    retry: false,
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!account.isLoading && !account.data) {
      window.location.replace("/login?next=%2Fakun");
    }
  }, [account.data, account.isLoading]);

  const consent = useMutation({
    mutationFn: (marketingOptIn: boolean) => updateAccount({ marketing_opt_in: marketingOptIn }),
    onSuccess: (user) => {
      queryClient.setQueryData(["current-account"], user);
      toast.success(
        user.marketing_opt_in
          ? "Izin informasi WhatsApp diaktifkan."
          : "Izin informasi WhatsApp dinonaktifkan.",
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const password = useMutation({
    mutationFn: () =>
      updateAccount({ current_password: currentPassword, new_password: newPassword }),
    onSuccess: (user) => {
      queryClient.setQueryData(["current-account"], user);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password berhasil diganti.");
    },
    onError: (error) => toast.error(error.message),
  });
  const logout = useMutation({
    mutationFn: logoutAccount,
    onSuccess: () => {
      queryClient.setQueryData(["current-account"], null);
      window.location.assign("/");
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteAccount(deletePassword),
    onSuccess: () => {
      queryClient.setQueryData(["current-account"], null);
      toast.success("Akun berhasil dihapus.");
      window.location.assign("/");
    },
    onError: (error) => toast.error(error.message),
  });

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    password.mutate();
  };

  if (account.isLoading || !account.data) {
    return (
      <div className="public-page min-h-screen bg-background">
        <SiteHeader />
        <main className="public-workspace account-loading" aria-live="polite">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          <span>Memeriksa sesi akun...</span>
        </main>
      </div>
    );
  }

  const user = account.data;
  return (
    <div className="public-page min-h-screen bg-background">
      <SiteHeader />
      <main className="public-workspace account-workspace">
        <header className="account-heading">
          <div>
            <p className="public-kicker font-mono">AKUN TERVERIFIKASI</p>
            <h1>Pengaturan akun</h1>
            <p>Kelola akses dan pilihan komunikasi untuk nomor WhatsApp kamu.</p>
          </div>
          <button
            className="account-logout"
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            <span>Keluar</span>
          </button>
        </header>

        <section className="account-grid">
          <article className="account-identity">
            <div className="account-card-heading">
              <span>
                <UserRound className="h-5 w-5" />
              </span>
              <div>
                <p className="font-mono">IDENTITAS</p>
                <h2>Nomor WhatsApp</h2>
              </div>
            </div>
            <strong className="account-phone font-mono">
              {maskAccountWhatsapp(user.whatsapp)}
            </strong>
            <div className="account-verified-state">
              <CheckCircle2 className="h-4 w-4" />
              <span>Terverifikasi melalui bot AnalisaCPNS</span>
            </div>
            <dl className="account-meta">
              <div>
                <dt>Bergabung</dt>
                <dd>{formatAccountDate(user.created_at)}</dd>
              </div>
              <div>
                <dt>Login terakhir</dt>
                <dd>{user.last_login_at ? formatAccountDate(user.last_login_at) : "Hari ini"}</dd>
              </div>
            </dl>
          </article>

          <div className="account-settings">
            <article className="account-setting-row">
              <div className="account-setting-icon">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="account-setting-copy">
                <h2>Informasi CPNS dan tryout</h2>
                <p>Izinkan tim mengirim informasi dan promo melalui akun WhatsApp resmi.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={user.marketing_opt_in}
                aria-label="Izin informasi WhatsApp"
                className={`account-switch ${user.marketing_opt_in ? "is-on" : ""}`}
                onClick={() => consent.mutate(!user.marketing_opt_in)}
                disabled={consent.isPending}
              >
                <i />
              </button>
            </article>

            <article className="account-password-card">
              <div className="account-card-heading">
                <span>
                  <KeyRound className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-mono">KEAMANAN</p>
                  <h2>Ganti password</h2>
                </div>
              </div>
              <form onSubmit={submitPassword} className="account-password-form">
                <input
                  hidden
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={user.whatsapp}
                  readOnly
                />
                <label>
                  <span>Password saat ini</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Password baru</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    placeholder="Minimal 8 karakter, huruf dan angka"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="account-save" disabled={password.isPending}>
                  {password.isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  <span>Simpan password</span>
                  {!password.isPending ? <ArrowRight className="h-4 w-4" /> : null}
                </button>
              </form>
            </article>

            <article className="account-danger-row">
              <div>
                <h2>Hapus akun</h2>
                <p>Nomor, sesi login, dan pengaturan akun akan dihapus permanen.</p>
              </div>
              <button type="button" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" />
                <span>Hapus</span>
              </button>
            </article>
          </div>
        </section>
      </main>
      <SiteFooter />

      {deleteOpen ? (
        <div
          className="account-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setDeleteOpen(false)}
        >
          <section
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="account-dialog-icon">
              <Trash2 className="h-5 w-5" />
            </span>
            <h2 id="delete-account-title">Hapus akun permanen?</h2>
            <p>Masukkan password untuk mengonfirmasi. Tindakan ini tidak dapat dibatalkan.</p>
            <label>
              <span>Password</span>
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            </label>
            <div>
              <button
                type="button"
                className="account-dialog-cancel"
                onClick={() => setDeleteOpen(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className="account-dialog-delete"
                onClick={() => remove.mutate()}
                disabled={!deletePassword || remove.isPending}
              >
                {remove.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Hapus akun
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function formatAccountDate(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
