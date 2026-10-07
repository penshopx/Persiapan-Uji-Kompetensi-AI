import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { Search, ExternalLink, AlertTriangle } from 'lucide-react';
import { useGetCompetencyCatalog, getGetCompetencyCatalogQueryKey } from '@workspace/api-client-react';
import { Disclaimer, Empty, ErrorBlock, Skeleton, SourceBadge } from '@/components/bits';
import { useSelection } from '@/lib/store';

export default function Catalog() {
  const cat = useGetCompetencyCatalog({ query: { queryKey: getGetCompetencyCatalogQueryKey() } });
  const [, nav] = useLocation();
  const [, setSel] = useSelection();
  const [q, setQ] = useState('');
  const [k, setK] = useState(() => new URLSearchParams(window.location.search).get('k') || 'all');
  const [lvl, setLvl] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const data = cat.data;
  const levels = useMemo(() => Array.from(new Set(data?.roles.map((r) => r.level) ?? [])).sort((a, b) => a - b), [data]);
  const roles = useMemo(() => (data?.roles ?? []).filter((r) =>
    (k === 'all' || r.classificationId === k) && (lvl === 'all' || String(r.level) === lvl) &&
    `${r.title} ${r.family} ${r.qualification}`.toLowerCase().includes(q.trim().toLowerCase())), [data, k, lvl, q]);
  const role = data?.roles.find((r) => r.id === openId);
  const std = data?.standards.find((s) => s.id === role?.standardId);
  const units = data?.units.filter((u) => u.standardId === role?.standardId) ?? [];

  const practise = (unitCode: string) => {
    if (!role) return;
    setSel({ roleId: role.id, unitCode });
    nav('/latihan');
  };

  const chip = (active: boolean) => `px-3 py-1.5 text-sm font-bold border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground'}`;

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="text-4xl font-extrabold tracking-tight">Katalog kompetensi</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Peran dan unit diambil langsung dari data sumber. Klasifikasi tanpa data ditampilkan apa adanya, tanpa peran karangan.</p>
      </div>
      <Disclaimer />
      {cat.isLoading ? <Skeleton rows={6} /> : cat.isError || !data ? <ErrorBlock onRetry={() => cat.refetch()} /> : (
        <>
          <div className="space-y-3">
            <label className="flex items-center gap-3 border-2 border-input bg-card px-3 focus-within:border-primary">
              <Search className="h-5 w-5 text-primary" />
              <input data-testid="input-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari peran, rumpun, atau kualifikasi" className="w-full bg-transparent py-3 outline-none placeholder:text-muted-foreground" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button data-testid="chip-class-all" className={chip(k === 'all')} onClick={() => setK('all')}>Semua klasifikasi</button>
              {data.classifications.map((c) => (
                <button key={c.id} data-testid={`chip-class-${c.id}`} className={chip(k === c.id)} onClick={() => setK(c.id)}>{c.name}{!c.available && ' (belum tersedia)'}</button>
              ))}
            </div>
            {levels.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-xs uppercase text-muted-foreground">Jenjang</span>
                <button className={chip(lvl === 'all')} onClick={() => setLvl('all')} data-testid="chip-level-all">Semua</button>
                {levels.map((l) => <button key={l} className={chip(lvl === String(l))} onClick={() => setLvl(String(l))} data-testid={`chip-level-${l}`}>{l}</button>)}
              </div>
            )}
            {k !== 'all' && (() => { const c = data.classifications.find((x) => x.id === k); return c && (
              <p data-testid="text-class-status" className="mono text-xs text-muted-foreground">{c.description} — status sumber: {c.sourceStatus}</p>); })()}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-2" data-testid="list-roles">
              <p className="mono text-xs text-muted-foreground">{roles.length} peran ditemukan</p>
              {roles.length === 0 ? (
                <Empty title="Tidak ada peran yang cocok" hint={k !== 'all' && data.classifications.find((c) => c.id === k && !c.available) ? 'Klasifikasi ini belum memiliki data sumber, sehingga belum ada peran yang bisa ditampilkan.' : 'Ubah kata kunci atau filter untuk melihat peran lain.'}>
                  <button className="border border-primary px-4 py-2 text-sm font-bold text-primary" onClick={() => { setQ(''); setK('all'); setLvl('all'); }} data-testid="button-reset-filter">Atur ulang filter</button>
                </Empty>
              ) : roles.map((r) => (
                <button key={r.id} data-testid={`card-role-${r.id}`} onClick={() => setOpenId(r.id)}
                  className={`block w-full border p-4 text-left transition-all hover:-translate-y-0.5 ${openId === r.id ? 'border-primary bg-primary/15' : 'border-border bg-card hover:border-primary/60'}`}>
                  <p className="mono text-[11px] uppercase text-primary">{r.family} · jenjang {r.level}</p>
                  <p className="mt-1 text-lg font-extrabold leading-snug">{r.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{r.qualification}</p>
                  <p className="mono mt-2 text-xs text-muted-foreground">{r.unitCount} unit rujukan · {r.readiness}</p>
                </button>
              ))}
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              {!role ? (
                <Empty title="Pilih satu peran" hint="Detail standar, status sumber, dan unit rujukan muncul di sini." />
              ) : (
                <div key={role.id} data-testid="panel-role-detail" className="rise panel-light p-5">
                  <p className="mono text-xs font-semibold uppercase">{role.family} · jenjang {role.level}</p>
                  <h2 className="mt-1 text-2xl font-extrabold leading-tight">{role.title}</h2>
                  <p className="sub mt-1 text-sm">{role.qualification}</p>
                  {std ? (
                    <div className="mt-4 border-2 border-foreground/80 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2"><SourceBadge text={std.status} /><span className="mono text-xs">{std.standardType} {std.code} · {std.year}</span></div>
                      <p className="mt-2 font-bold">{std.title}</p>
                      {std.registrationCode && <p className="mono sub text-xs">Reg: {std.registrationCode}</p>}
                      <p className="mt-2 flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{std.statusNote}</p>
                      <a href={std.sourceUrl} target="_blank" rel="noreferrer" data-testid="link-source" className="mt-2 inline-flex items-center gap-1 font-bold underline">Buka sumber <ExternalLink className="h-3.5 w-3.5" /></a>
                    </div>
                  ) : <p className="mt-4 text-sm font-bold">Data standar untuk peran ini tidak ditemukan.</p>}
                  <p className="mt-4 text-sm font-bold">Unit rujukan ({units.length})</p>
                  <p className="sub text-xs">Unit dari standar di atas, bukan paket sertifikasi tingkat jenjang terverifikasi.</p>
                  <div className="mt-2 max-h-80 space-y-2 overflow-y-auto pr-1">
                    {units.length === 0 && <p className="text-sm">Belum ada unit untuk standar ini.</p>}
                    {units.map((u) => (
                      <div key={u.code} data-testid={`row-unit-${u.code}`} className="flex items-start justify-between gap-3 bg-background p-3 text-foreground">
                        <div>
                          <p className="mono text-xs text-primary">{u.code}</p>
                          <p className="text-sm font-bold">{u.title}</p>
                          <p className="text-xs text-muted-foreground">{u.sourceNote}</p>
                        </div>
                        <button onClick={() => practise(u.code)} data-testid={`button-practise-${u.code}`} className="shrink-0 bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">Latih</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => practise(units[0]?.code ?? '')} disabled={!units.length} data-testid="button-select-role" className="mt-4 w-full bg-background px-4 py-3 font-bold text-foreground disabled:opacity-50">Pilih peran ini untuk latihan</button>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
