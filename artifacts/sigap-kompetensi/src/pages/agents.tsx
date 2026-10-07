import { useGetCompetencySummary, getGetCompetencySummaryQueryKey } from '@workspace/api-client-react';
import { ErrorBlock, Skeleton } from '@/components/bits';

export default function Agents() {
  const sum = useGetCompetencySummary({ query: { queryKey: getGetCompetencySummaryQueryKey() } });
  return (
    <div className="space-y-8">
      <div className="rise">
        <h1 className="text-4xl font-extrabold tracking-tight">Agen spesialis</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Daftar tanggung jawab di bawah diambil dari layanan, bukan teks statis.</p>
      </div>
      <section className="panel-light p-5" data-testid="panel-runtime">
        <h2 className="text-xl font-extrabold">Runtime yang sebenarnya</h2>
        <p className="mt-2 max-w-3xl">Pipeline terbatas ini dijalankan oleh OpenAI melalui Replit AI Integrations. Runtime MultiClaw atau Hermes <b>tidak terpasang</b> di aplikasi ini. Setiap agen adalah tahap berperan khusus dengan batas tugas yang jelas, bukan proses otonom yang berjalan sendiri.</p>
        <p className="sub mt-2 max-w-3xl text-sm">Pemakaian AI ditagihkan ke kredit Replit. Hasil evaluasi adalah umpan balik persiapan, bukan keputusan asesor atau sertifikasi.</p>
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
