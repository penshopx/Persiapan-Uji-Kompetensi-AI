import { Link } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { useGetCompetencyCatalog, useGetCompetencySummary, getGetCompetencyCatalogQueryKey, getGetCompetencySummaryQueryKey } from '@workspace/api-client-react';
import { Disclaimer, ErrorBlock, Skeleton, SourceBadge } from '@/components/bits';
import { useSelection, useStudyHistory, statusLabel } from '@/lib/store';

export default function Dashboard() {
  const sum = useGetCompetencySummary({ query: { queryKey: getGetCompetencySummaryQueryKey() } });
  const cat = useGetCompetencyCatalog({ query: { queryKey: getGetCompetencyCatalogQueryKey() } });
  const [sel] = useSelection();
  const [hist] = useStudyHistory();
  const role = cat.data?.roles.find((r) => r.id === sel?.roleId);
  const last = hist[0];
  const stats = sum.data ? [
    ['Klasifikasi', sum.data.classificationCount], ['Peran', sum.data.roleCount], ['Unit rujukan', sum.data.unitCount], ['Perlu ditinjau', sum.data.reviewCount],
  ] : [];
  return (
    <div className="space-y-10">
      <section className="rise grid gap-6 md:grid-cols-5">
        <div className="md:col-span-3">
          <p className="mono text-xs uppercase tracking-widest text-primary">Ruang persiapan kompetensi konstruksi</p>
          <h1 className="mt-3 text-5xl font-extrabold leading-[0.95] tracking-tight md:text-7xl">Siap uji, <span className="text-primary">bukan sekadar hafal.</span></h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">Telusuri katalog lintas klasifikasi dengan status sumber yang jelas, lalu berlatih unit per unit bersama agen spesialis.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/katalog" data-testid="link-cta-katalog" className="inline-flex items-center gap-2 bg-primary px-5 py-3 font-bold text-primary-foreground transition-transform hover:translate-x-1">Buka katalog <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/latihan" data-testid="link-cta-latihan" className="inline-flex items-center gap-2 border-2 border-foreground px-5 py-3 font-bold hover:bg-foreground hover:text-background">Mulai latihan</Link>
          </div>
        </div>
        <div className="panel-light p-5 md:col-span-2">
          <p className="mono text-xs font-semibold uppercase tracking-widest">Lanjutkan belajar</p>
          {role ? (
            <div data-testid="card-continue" className="mt-3">
              <p className="text-2xl font-extrabold leading-tight">{role.title}</p>
              <p className="sub mono mt-1 text-sm">Unit {sel?.unitCode || 'belum dipilih'}</p>
              {last && <p className="sub mt-2 text-sm">Terakhir: {statusLabel[last.status || ''] || 'tanpa evaluasi'}{last.score != null ? `, skor ${last.score}` : ''}</p>}
              <Link href="/latihan" data-testid="link-continue" className="mt-4 inline-flex items-center gap-2 bg-background px-4 py-2 text-sm font-bold text-foreground">Lanjut ke latihan <ArrowRight className="h-4 w-4" /></Link>
            </div>
          ) : (
            <div data-testid="card-continue-empty" className="mt-3">
              <p className="text-xl font-extrabold">Belum ada peran terpilih</p>
              <p className="sub mt-1 text-sm">Pilih peran dari katalog untuk memulai latihan pertama Anda.</p>
              <Link href="/katalog" className="mt-4 inline-block bg-background px-4 py-2 text-sm font-bold text-foreground">Pilih dari katalog</Link>
            </div>
          )}
        </div>
      </section>

      <section>
        {sum.isLoading ? <Skeleton rows={1} /> : sum.isError ? <ErrorBlock onRetry={() => sum.refetch()} /> : (
          <div className="grid grid-cols-2 gap-px border border-border bg-border md:grid-cols-4">
            {stats.map(([l, v], i) => (
              <div key={l} data-testid={`stat-${i}`} className="rise bg-card p-5" style={{ animationDelay: `${i * 80}ms` }}>
                <p className="mono text-4xl font-semibold text-primary">{v}</p>
                <p className="mt-1 text-sm text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
        )}
        {sum.data && sum.data.reviewCount > 0 && <p data-testid="text-review-warning" className="mt-3 text-sm text-muted-foreground">{sum.data.reviewCount} butir masih memerlukan tinjauan sumber. Periksa status standar pada katalog sebelum dijadikan acuan.</p>}
      </section>

      <Disclaimer />

      <section>
        <h2 className="text-2xl font-extrabold">Klasifikasi</h2>
        <div className="mt-4 space-y-3">
          {cat.isLoading ? <Skeleton /> : cat.isError ? <ErrorBlock onRetry={() => cat.refetch()} /> : cat.data?.classifications.map((c, i) => (
            <div key={c.id} data-testid={`card-class-${c.id}`} className="rise grid gap-3 border border-border bg-card p-5 md:grid-cols-[1fr_auto] md:items-center" style={{ animationDelay: `${i * 70}ms` }}>
              <div>
                <div className="flex flex-wrap items-center gap-3"><h3 className="text-xl font-extrabold">{c.name}</h3><SourceBadge text={c.available ? 'tersedia' : 'belum tersedia'} /></div>
                <p className="mt-1 text-muted-foreground">{c.description}</p>
                <p className="mono mt-2 text-xs text-muted-foreground">Status sumber: {c.sourceStatus}</p>
              </div>
              {c.available ? (
                <Link href={`/katalog?k=${encodeURIComponent(c.id)}`} data-testid={`link-class-${c.id}`} className="inline-flex items-center gap-2 border border-primary px-4 py-2 text-sm font-bold text-primary hover:bg-primary hover:text-primary-foreground">{c.roleCount} peran <ArrowRight className="h-4 w-4" /></Link>
              ) : <span className="mono text-sm text-muted-foreground">0 peran</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
