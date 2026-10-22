import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Lock, ShieldCheck } from 'lucide-react';
import { useCreateUjkJourney, useGetCompetencyCatalog, getGetCompetencyCatalogQueryKey } from '@workspace/api-client-react';
import { Disclaimer, Empty, ErrorBlock, Skeleton } from '@/components/bits';
import { usePassport, useSignedIn } from '@/hooks/use-ujk';
import { useQueryClient } from '@tanstack/react-query';
import { getGetUjkPassportQueryKey } from '@workspace/api-client-react';
import { errMsg, fmtDate, statusText } from '@/lib/ujk';

const field = 'w-full border-2 border-input bg-card px-3 py-3 outline-none focus:border-primary';

export default function Paspor() {
  const { signedIn } = useSignedIn();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const passport = usePassport();
  const cat = useGetCompetencyCatalog({ query: { queryKey: getGetCompetencyCatalogQueryKey(), enabled: signedIn, staleTime: 60000 } });
  const create = useCreateUjkJourney();
  const [roleId, setRoleId] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const roles = cat.data?.roles.filter((r) => r.practiceAvailable) ?? [];
  const journeys = passport.data?.journeys ?? [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleId || !consent) return;
    setErr(null);
    create.mutate({ data: { roleId, consent: true } }, {
      onSuccess: (j) => { qc.invalidateQueries({ queryKey: getGetUjkPassportQueryKey() }); nav(`/ujk/${j.id}`); },
      onError: (x) => setErr(errMsg(x, 'Perjalanan gagal dibuat.')),
    });
  };

  return (
    <div className="space-y-8">
      <div className="rise">
        <p className="mono text-xs uppercase text-primary">Paspor persiapan</p>
        <h1 className="text-4xl font-extrabold tracking-tight">Paspor UJK Anda</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Satu perjalanan per jabatan. Anda menilai diri, melampirkan bukti, dan melihat celah yang tersisa. Tidak ada skor AI yang menentukan kesiapan.</p>
      </div>
      <Disclaimer />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-3" data-testid="list-journeys">
          <h2 className="text-xl font-extrabold">Perjalanan saya</h2>
          {passport.isLoading ? <Skeleton rows={3} /> : passport.isError ? <ErrorBlock message={errMsg(passport.error)} onRetry={() => passport.refetch()} /> : journeys.length === 0 ? (
            <Empty title="Paspor masih kosong" hint="Mulai perjalanan pertama dengan memilih jabatan yang unit sumbernya sudah diproses." />
          ) : journeys.map((j) => (
            <Link key={j.id} href={`/ujk/${j.id}`} data-testid={`card-journey-${j.id}`} className="group block border border-border bg-card p-4 transition-colors hover:border-primary">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-lg font-extrabold">{j.title}</p>
                <span className={`mono border px-2 py-0.5 text-[11px] uppercase ${j.status === 'siap_diajukan' ? 'border-primary text-primary' : j.status === 'perlu_perbaikan' ? 'border-amber-400 text-amber-300' : 'border-border text-muted-foreground'}`}>{statusText[j.status]}</span>
              </div>
              <div className="mt-3 h-2 bg-muted"><div className="h-2 bg-primary" style={{ width: `${j.unitCount ? (j.learnedCount / j.unitCount) * 100 : 0}%` }} /></div>
              <div className="mono mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>{j.learnedCount}/{j.unitCount} unit dipelajari · K3 {j.safetyPassed ? 'lulus internal' : 'belum'} · skema {j.schemeVerified ? 'terverifikasi' : 'belum terverifikasi'}</span>
                <span>dibuat {fmtDate(j.createdAt)} <ArrowRight className="inline h-3 w-3 transition-transform group-hover:translate-x-1" /></span>
              </div>
            </Link>
          ))}
        </section>

        <form onSubmit={submit} className="h-fit space-y-4 border-2 border-primary bg-card p-5" data-testid="form-create-journey">
          <h2 className="text-xl font-extrabold">Mulai perjalanan baru</h2>
          {cat.isLoading ? <Skeleton rows={1} /> : cat.isError ? <ErrorBlock onRetry={() => cat.refetch()} /> : (
            <label className="block"><span className="mono text-xs uppercase text-primary">Jabatan</span>
              <select data-testid="select-journey-role" className={field} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">Pilih jabatan</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.title} (J{r.level})</option>)}
              </select></label>
          )}
          <p className="text-xs text-muted-foreground">Hanya jabatan dengan unit sumber yang telah diproses yang dapat dimulai. Entri katalog lain tidak dibuatkan unit rekaan.</p>
          <div className="space-y-2 border-l-2 border-primary bg-primary/10 p-3 text-sm">
            <p className="flex gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Berkas bukti disimpan privat di penyimpanan terproteksi. Peninjau yang ditugaskan hanya mendapat akses dengan persetujuan Anda, yang dapat dicabut. Isi berkas tidak masuk basis data.</p>
            <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Riwayat bersifat tambah-saja: catatan lama tidak diubah atau dihapus, koreksi ditulis sebagai catatan baru beralasan. Kami tidak meminta NIK.</p>
          </div>
          <label className="flex items-start gap-3 text-sm"><input data-testid="check-consent" type="checkbox" className="mt-1 h-5 w-5 accent-[hsl(212_100%_62%)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Saya mengerti dan setuju bukti disimpan privat serta riwayat perjalanan ini dipertahankan.</span></label>
          {err && <p role="alert" data-testid="text-create-error" className="border border-destructive/60 bg-destructive/10 p-3 text-sm">{err}</p>}
          <button data-testid="button-create-journey" disabled={!roleId || !consent || create.isPending} className="w-full bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-40">{create.isPending ? 'Membuat…' : 'Buat perjalanan'}</button>
        </form>
      </div>
    </div>
  );
}
