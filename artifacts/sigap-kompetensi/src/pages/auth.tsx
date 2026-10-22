import { SignIn, SignUp } from '@clerk/react';
import { Link } from 'wouter';
import { LogoMark } from '@/components/logo';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function Shell({ children, mode }: { children: React.ReactNode; mode: 'in' | 'up' }) {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1fr_520px]">
      <aside className="hidden flex-col justify-between border-r-2 border-primary p-10 lg:flex">
        <Link href="/" className="flex items-center gap-3"><LogoMark className="h-10 w-10" /><span className="text-xl font-extrabold">SIGAP <span className="text-primary">Kompetensi</span></span></Link>
        <div className="space-y-5">
          <p className="mono text-xs uppercase text-primary">Paspor persiapan UJK</p>
          <h1 className="max-w-lg text-5xl font-extrabold leading-[1.05] tracking-tight">Kemajuan jujur, bukti nyata, bukan skor AI.</h1>
          <ul className="max-w-md space-y-2 text-muted-foreground">
            <li>Catatan belajar tersimpan per akun, riwayat hanya bertambah.</li>
            <li>Bukti kerja disimpan privat. Peninjau yang ditugaskan hanya dapat membukanya dengan persetujuan Anda.</li>
            <li>Kami tidak meminta NIK. Kelulusan hanya ditetapkan LSP.</li>
          </ul>
        </div>
        <p className="mono text-xs text-muted-foreground">{mode === 'in' ? 'Belum punya akun? Pilih Daftar.' : 'Sudah punya akun? Pilih Masuk.'}</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10">{children}</main>
    </div>
  );
}

export function SignInPage() {
  return <Shell mode="in"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></Shell>;
}
export function SignUpPage() {
  return <Shell mode="up"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></Shell>;
}
