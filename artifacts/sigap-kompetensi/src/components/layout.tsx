import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';
import { Disclaimer } from '@/components/bits';

const nav = [
  { href: '/', label: 'Dasbor' },
  { href: '/katalog', label: 'Katalog' },
  { href: '/latihan', label: 'Latihan' },
  { href: '/agen', label: 'Agen' },
];

export function Layout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  useEffect(() => {
    const label = nav.find((n) => n.href === loc)?.label ?? 'Halaman tidak ditemukan';
    const descriptions: Record<string, string> = {
      '/': 'Ringkasan cakupan jabatan, unit rujukan, dan progres persiapan uji kompetensi konstruksi.',
      '/katalog': 'Telusuri klasifikasi, jabatan, jenjang, serta dokumen SKKNI dan SKKK untuk latihan kompetensi.',
      '/latihan': 'Berlatih studi kasus dan memperoleh evaluasi jawaban teks dari agen AI dengan rujukan standar.',
      '/agen': 'Pelajari tanggung jawab dan batas kemampuan peran agen spesialis SIGAP Kompetensi.',
    };
    document.title = `${label} — SIGAP Kompetensi`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', descriptions[loc] ?? 'SIGAP Kompetensi — persiapan uji kompetensi konstruksi.');
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', descriptions[loc] ?? '');
  }, [loc]);
  const h = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60000 } });
  const ok = h.data?.status === 'ok' || (!!h.data && !h.isError);
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 border-b-2 border-primary bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" data-testid="link-home" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center bg-primary text-sm font-extrabold text-primary-foreground">SK</span>
            <span className="text-lg font-extrabold tracking-tight">SIGAP <span className="text-primary">Kompetensi</span></span>
          </Link>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
            {nav.map((n) => {
              const active = n.href === '/' ? loc === '/' : loc.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} data-testid={`link-nav-${n.label.toLowerCase()}`}
                  className={`relative px-4 py-2 text-sm font-bold transition-colors ${active ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <span data-testid="status-service" className="mono flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${h.isLoading ? 'bg-muted-foreground' : ok ? 'bg-primary' : 'bg-destructive'}`} />
            {h.isLoading ? 'memeriksa layanan' : ok ? 'layanan aktif' : 'layanan tidak tersedia'}
          </span>
        </div>
      </header>
      <motion.main key={loc} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </motion.main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl space-y-3 px-4 py-6">
          <Disclaimer compact />
          <p className="mono text-xs text-muted-foreground">SIGAP Kompetensi — ruang persiapan uji kompetensi konstruksi. Bukan lembaga sertifikasi.</p>
        </div>
      </footer>
    </div>
  );
}
