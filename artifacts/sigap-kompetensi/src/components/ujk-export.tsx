import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateUjkExport, useListUjkExports, useRevokeUjkExport, getListUjkExportsQueryKey, downloadUjkExport,
  type UjkJourneyDetail,
} from '@workspace/api-client-react';
import { ErrorBlock } from '@/components/bits';
import { errMsg, fmtDate, statusText } from '@/lib/ujk';

export function UjkExport({ id, detail: d, onDone }: { id: string; detail: UjkJourneyDetail; onDone: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const query = useListUjkExports(id, { query: { queryKey: getListUjkExportsQueryKey(id), staleTime: 0, refetchInterval: 30000 } });
  const create = useCreateUjkExport(), revoke = useRevokeUjkExport();
  const qc = useQueryClient();
  const busy = create.isPending || revoke.isPending || !!downloading;
  useEffect(() => { setConsent(false); }, [d.review.lastEventId, d.scheme?.id, d.journey.status]);
  const refresh = () => { qc.invalidateQueries({ queryKey: getListUjkExportsQueryKey(id) }); onDone(); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      await create.mutateAsync({ id, data: { evidenceIds: selected, consent: true, lastEventId: d.review.lastEventId, schemeId: d.scheme?.id ?? null } });
      setConsent(false); refresh();
    } catch (e) { setError(errMsg(e)); setConsent(false); onDone(); }
  };
  const download = async (exportId: string) => {
    setError(null); setDownloading(exportId);
    try {
      const blob = await downloadUjkExport(id, exportId, { responseType: 'blob' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl; link.download = `persiapan-ujk-${exportId}.zip`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      onDone();
    } catch (e) { setError(errMsg(e)); }
    finally { setDownloading(null); }
  };
  const missing = d.requiredUnitCodes.filter(code => !d.evidence.some(e => selected.includes(e.id) && e.unitCode === code && e.reviewStatus === 'accepted'));
  return <section className="space-y-5" data-testid="panel-export">
    <div className="space-y-2 border-l-4 border-primary bg-primary/10 p-4 text-sm">
      <h2 className="text-xl font-extrabold">Paket persiapan untuk LSP</h2>
      <p>Bukan sertifikat dan bukan keputusan K/BK. Tidak dikirim otomatis kepada LSP; Anda menentukan penyerahannya setelah memeriksa paket.</p>
      <p>ZIP memuat snapshot kesiapan, versi dan sumber skema, unit dan rencana belajar, riwayat reviewer terkait, laporan serta jawaban simulasi. Hanya bukti yang dicentang yang disalin, beserta riwayat review-nya.</p>
      <p>Unduhan hanya untuk akun Anda selama 24 jam dan dapat dicabut lebih awal. Salinan yang sudah diunduh tidak dapat ditarik kembali. Maksimal 20 bukti, total ZIP 50 MB.</p>
    </div>
    <form onSubmit={submit} className="space-y-3 border border-border bg-card p-4">
      <p className="font-bold">Pilih bukti privat yang diizinkan masuk paket</p>
      {d.evidence.length === 0 && <p className="text-sm text-muted-foreground">Belum ada bukti. Anda tetap dapat membuat paket ringkasan tanpa berkas bukti.</p>}
      {d.evidence.map(e => <label key={e.id} className="flex items-start gap-3 border border-border p-3 text-sm">
        <input type="checkbox" disabled={busy} data-testid={`check-export-${e.id}`} checked={selected.includes(e.id)} onChange={event => {
          setSelected(ids => event.target.checked ? [...ids, e.id] : ids.filter(i => i !== e.id)); setConsent(false);
        }} className="mt-1 h-5 w-5" />
        <span><b>{e.title}</b> · {e.unitCode}<br />{e.fileName} · {(e.size / 1048576).toFixed(2)} MB · review: {e.reviewStatus}</span>
      </label>)}
      <p className="text-sm">Kesiapan paspor: <b>{statusText[d.journey.status]}</b>. Dipilih: {selected.length} bukti. {d.journey.schemeVerified ? `Unit wajib tanpa bukti terpilih yang diterima: ${missing.length}.` : 'Skema belum terverifikasi/berlaku; paket ini tidak menyatakan unit rujukan sebagai wajib.'}</p>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" data-testid="check-export-consent" className="mt-1 h-5 w-5" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />
        Saya menyetujui pembuatan snapshot dan penyalinan hanya bukti yang saya pilih, untuk saya periksa dan serahkan sendiri kepada LSP.</label>
      <button data-testid="button-create-export" disabled={busy || !consent || selected.length > 20} className="bg-primary px-5 py-3 font-bold text-primary-foreground disabled:opacity-40">{create.isPending ? 'Membuat paket…' : 'Buat paket persiapan'}</button>
    </form>
    {error && <p role="alert" className="border border-destructive p-3 text-sm">{error}</p>}
    <h3 className="font-extrabold">Paket yang sudah dibuat</h3>
    {query.isLoading ? <p>Memuat paket…</p> : query.isError ? <ErrorBlock message={errMsg(query.error)} onRetry={() => query.refetch()} /> :
      !query.data?.length ? <p className="text-sm text-muted-foreground">Belum ada paket.</p> :
      query.data.map(p => {
        const active = !p.revokedAt && new Date(p.expiresAt).getTime() > Date.now();
        return <div key={p.id} className="space-y-2 border border-border bg-card p-4 text-sm" data-testid={`export-${p.id}`}>
          <p className="font-bold">Snapshot {fmtDate(p.snapshotAt)} · {p.evidenceCount} bukti · {(p.size / 1048576).toFixed(2)} MB</p>
          <p>Status historis: {p.readinessStatus} · {p.revokedAt ? 'Akses dicabut' : active ? `Batas akses: ${fmtDate(p.expiresAt)}` : 'Akses kedaluwarsa'}</p>
          <p className="break-all font-mono text-xs">SHA-256: {p.sha256}</p>
          {active && <div className="flex flex-wrap gap-3">
            <button disabled={busy} onClick={() => download(p.id)} className="bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-40">{downloading === p.id ? 'Mengunduh…' : 'Unduh ZIP'}</button>
            <button disabled={busy} onClick={async () => {
              setError(null);
              try { await revoke.mutateAsync({ id, exportId: p.id }); refresh(); }
              catch (e) { setError(errMsg(e)); }
            }} className="border border-destructive px-4 py-2 font-bold text-destructive disabled:opacity-40">Cabut akses unduhan</button>
          </div>}
        </div>;
      })}
  </section>;
}
