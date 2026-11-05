import { useGetCompetencySummary, getGetCompetencySummaryQueryKey } from '@workspace/api-client-react';
import { ErrorBlock, Skeleton } from '@/components/bits';

export default function Agents() {
  const sum = useGetCompetencySummary({ query: { queryKey: getGetCompetencySummaryQueryKey(), refetchInterval: 30000, staleTime: 0 } });
  const runtime = sum.data?.runtime;
  return (
    <div className="space-y-8">
      <div className="rise">
        <h1 className="text-4xl font-extrabold tracking-tight">Agen spesialis</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Daftar tanggung jawab di bawah diambil dari layanan, bukan teks statis.</p>
      </div>
      <section className="panel-light p-5" data-testid="panel-runtime">
        <h2 className="text-xl font-extrabold">Runtime yang sebenarnya</h2>
        {sum.isLoading ? <p className="mt-2">Memeriksa runtime…</p> : sum.isError || !runtime ? <p className="mt-2">Status runtime belum dapat dimuat. Tidak ada koneksi yang diasumsikan berhasil.</p> : <>
          <p className="mt-2 font-bold">{runtime.selected === 'hermes' ? 'Hermes Agent — NousResearch' : 'OpenAI — Replit AI Integrations'} · {({ ready: 'Pemeriksaan konfigurasi lulus', not_configured: 'Belum dikonfigurasi', unavailable: 'Tidak tersedia', unsafe: 'Diblokir demi keamanan' })[runtime.status]}</p>
          <p className="mt-2 max-w-3xl" data-testid="runtime-message">{runtime.message}</p>
          {runtime.selected !== 'hermes' && <p className="mt-2 max-w-3xl">Adapter Hermes tersedia, tetapi {runtime.hermesConfigured ? 'belum dipilih; koneksinya belum diverifikasi' : 'layanan dan kredensialnya belum dikonfigurasi'}. MultiClaw tidak digunakan.</p>}
          <p className="sub mt-2 text-sm">Diperiksa: {new Date(runtime.checkedAt).toLocaleString('id-ID')}. Status diperbarui setiap 30 detik.</p>
        </>}
        <p className="sub mt-2 max-w-3xl text-sm">Peran agen adalah tahap terbatas, bukan proses otonom. Runtime tiap tahap yang selesai ditampilkan pada hasil latihan dan disimpan bersama hasil paspor. Tidak ada fallback runtime tersembunyi. Hasil AI bukan keputusan asesor atau sertifikasi.</p>
      </section>
      <section className="space-y-3">
        {sum.isLoading ? <Skeleton /> : sum.isError || !sum.data ? <ErrorBlock onRetry={() => sum.refetch()} /> : sum.data.agents.map((a, i) => (
          <div key={a.id} data-testid={`card-agent-${a.id}`} className="rise grid gap-2 border border-border bg-card p-5 md:grid-cols-[80px_1fr]" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="mono text-4xl font-semibold text-primary">{String(i + 1).padStart(2, '0')}</span>
            <div><h3 className="text-xl font-extrabold">{a.name}</h3><p className="mt-1 text-muted-foreground">{a.responsibility}</p></div>
          </div>
        ))}
      </section>
    </div>
  );
}
