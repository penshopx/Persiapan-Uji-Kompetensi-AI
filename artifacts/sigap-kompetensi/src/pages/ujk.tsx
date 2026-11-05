import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, PlayCircle } from 'lucide-react';
import {
  useCreateUjkSelfAssessment, useCreateUjkSafetyAttempt, useRequestUjkEvidenceUpload, useCreateUjkEvidence, useCreateUjkCorrection, useSetUjkReviewConsent, useSubmitUjkSimulation,
  getGetUjkJourneyQueryKey, type UjkJourneyDetail, type UjkUnitState,
} from '@workspace/api-client-react';
import { Empty, ErrorBlock, Skeleton } from '@/components/bits';
import { useInvalidateJourney, useJourney, usePagedHistory } from '@/hooks/use-ujk';
import { confidenceText, errMsg, fmtDate, statusText } from '@/lib/ujk';
import { UjkExport } from '@/components/ujk-export';

const field = 'w-full border-2 border-input bg-card px-3 py-3 outline-none focus:border-primary';
const btn = 'bg-primary px-5 py-2.5 font-bold text-primary-foreground disabled:opacity-40';
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg'] as const;
const MAX = 10 * 1024 * 1024;
type Tab = 'tinjau' | 'unit' | 'k3' | 'bukti' | 'ekspor' | 'koreksi' | 'riwayat';
const tabs: [Tab, string][] = [['tinjau', 'Tinjauan'], ['unit', 'Penilaian diri'], ['k3', 'K3'], ['bukti', 'Bukti'], ['ekspor', 'Paket LSP'], ['koreksi', 'Koreksi'], ['riwayat', 'Riwayat']];

function Err({ m }: { m: string | null }) {
  return m ? <p role="alert" data-testid="text-form-error" className="border border-destructive/60 bg-destructive/10 p-3 text-sm">{m}</p> : null;
}

export default function Ujk() {
  const { id = '' } = useParams<{ id: string }>();
  const q = useJourney(id);
  const search = useSearch();
  const requestedTab = new URLSearchParams(search).get('tab');
  const [tab, setTab] = useState<Tab>(tabs.some(([key]) => key === requestedTab) ? requestedTab as Tab : 'unit');
  useEffect(() => {
    if (tabs.some(([key]) => key === requestedTab)) setTab(requestedTab as Tab);
  }, [requestedTab]);
  const history = usePagedHistory(id);
  const invalidate = useInvalidateJourney();
  const qc = useQueryClient();
  const d = q.data;
  useEffect(() => { const t = setInterval(() => { invalidate(id); }, 30000); return () => clearInterval(t); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { invalidate(id); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const afterChange = (detail?: UjkJourneyDetail) => {
    if (detail) qc.setQueryData(getGetUjkJourneyQueryKey(id), detail);
    history.reset();
    invalidate(id);
  };

  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.isError || !d) return <ErrorBlock message={errMsg(q.error, 'Perjalanan tidak ditemukan atau bukan milik Anda.')} onRetry={() => q.refetch()} />;
  const j = d.journey;

  return (
    <div className="space-y-6">
      <div className="rise">
        <Link href="/paspor" data-testid="link-back-passport" className="mono text-xs uppercase text-primary">&larr; Paspor</Link>
        <Link href="/notifikasi" className="ml-4 text-xs font-bold text-primary">Pemberitahuan</Link>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight md:text-4xl">{j.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span data-testid="status-journey" className="panel-light px-3 py-1 text-sm font-extrabold">{statusText[j.status]}</span>
          <span className="mono text-xs text-muted-foreground">{j.learnedCount}/{j.unitCount} unit dipelajari · K3 {j.safetyPassed ? 'lulus gerbang internal' : 'belum lulus'}</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="border border-border bg-card p-4" data-testid="panel-blockers">
          <p className="font-extrabold">Yang masih menghalangi</p>
          {d.blockers.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Tidak ada penghalang menurut aturan internal. Ini bukan keputusan LSP.</p> :
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{d.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
        </div>
        <div className="space-y-2 border-l-4 border-amber-400 bg-amber-400/10 p-4 text-sm text-amber-100">
          <p><b>Aturan:</b> {d.ruleNote}</p>
          <p><b>Skema:</b> {d.schemeNote}</p>
          <p className="mono text-xs">Ambang latihan internal {d.threshold}, bukan ambang LSP. Simulasi {d.simulationPassed ? 'terpenuhi' : 'belum terpenuhi'}; hasil dihitung server.</p>
        </div>
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b-2 border-primary">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} data-testid={`tab-${k}`} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-bold ${tab === k ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>
        ))}
      </div>

      {tab === 'tinjau' && <ReviewTab id={id} d={d} onDone={afterChange} />}
      {tab === 'unit' && <UnitsTab id={id} d={d} onDone={afterChange} />}
      {tab === 'k3' && <SafetyTab id={id} d={d} onDone={afterChange} />}
      {tab === 'bukti' && <EvidenceTab id={id} d={d} onDone={afterChange} />}
      {tab === 'ekspor' && <UjkExport key={id} id={id} detail={d} onDone={afterChange} />}
      {tab === 'koreksi' && <CorrectionTab id={id} onDone={afterChange} />}
      {tab === 'riwayat' && (
        <section data-testid="list-history-events" className="space-y-3">
          <p className="text-sm text-muted-foreground">Riwayat hanya bertambah. Catatan lama tidak dapat diubah atau dihapus.</p>
          {history.isLoading ? <Skeleton rows={3} /> : history.isError && history.events.length === 0 ? <ErrorBlock message={errMsg(history.error)} onRetry={history.retry} /> :
            history.events.length === 0 ? <Empty title="Belum ada catatan" hint="Penilaian diri, bukti, K3, dan latihan akan muncul di sini." /> : (
              <ol className="space-y-2">
                {history.events.map((e) => (
                  <li key={e.id} data-testid={`event-${e.id}`} className="border-l-2 border-primary bg-card p-3 text-sm">
                    <p className="mono text-[11px] text-muted-foreground">#{e.id} · {fmtDate(e.createdAt)} · {e.kind}{e.unitCode ? ` · ${e.unitCode}` : ''}{e.score != null ? ` · skor ${e.score}` : ''}</p>
                    <p className="mt-1">{e.summary}</p>
                    {e.question && <p className="mt-1 text-muted-foreground">T: {e.question}</p>}
                    {e.answer && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">J: {e.answer}</p>}
                  </li>
                ))}
              </ol>
            )}
          {history.hasMore && <button data-testid="button-load-older" disabled={history.loadingMore} onClick={history.loadMore} className="border-2 border-primary px-4 py-2 font-bold text-primary disabled:opacity-40">{history.loadingMore ? 'Memuat…' : 'Muat catatan lebih lama'}</button>}
          {history.isError && history.events.length > 0 && <ErrorBlock message={errMsg(history.error, 'Catatan lebih lama belum dapat dimuat.')} onRetry={history.retry} />}
        </section>
      )}
    </div>
  );
}

function UnitsTab({ id, d, onDone }: { id: string; d: UjkJourneyDetail; onDone: (x?: UjkJourneyDetail) => void }) {
  const m = useCreateUjkSelfAssessment();
  const [code, setCode] = useState(d.units[0]?.code ?? '');
  const unit: UjkUnitState | undefined = d.units.find((u) => u.code === code);
  const [conf, setConf] = useState<'none' | 'learning' | 'practiced' | 'confident'>('none');
  const [learned, setLearned] = useState(false);
  const [plan, setPlan] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (unit) { setConf(unit.confidence); setLearned(unit.learned); setPlan(unit.plan); setReason(''); setErr(null); } }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    m.mutate({ id, data: { unitCode: code, confidence: conf, learned, plan, reason: reason.trim() } }, {
      onSuccess: (r) => { setReason(''); onDone(r); }, onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <ul className="space-y-2" data-testid="list-units">
        {d.units.map((u) => (
          <li key={u.code} className={`border bg-card p-3 ${u.code === code ? 'border-primary' : 'border-border'}`}>
            <button type="button" data-testid={`button-unit-${u.code}`} onClick={() => setCode(u.code)} className="block w-full text-left">
              <p className="mono text-xs text-primary">{u.code}{u.safetyCritical ? ' · kritis K3' : ''}{d.requiredUnitCodes.includes(u.code) ? ' · wajib skema' : d.requiredUnitCodes.length ? ' · rujukan' : ''}</p>
              <p className="font-bold">{u.title}</p>
              <p className="mono mt-1 text-[11px] text-muted-foreground">{u.learned ? 'dipelajari' : 'belum'} · {confidenceText[u.confidence]} · skor latihan {u.lastScore ?? '-'} · bukti {u.evidenceCount} (ditinjau {u.reviewedEvidenceCount})</p>
            </button>
            {u.gaps.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-amber-200">{u.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>}
            <Link href={`/latihan?journey=${id}&unit=${encodeURIComponent(u.code)}`} data-testid={`link-practice-${u.code}`} className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-primary"><PlayCircle className="h-4 w-4" /> Latihan unit ini</Link>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="h-fit space-y-3 border-2 border-primary bg-card p-4" data-testid="form-self-assessment">
        <p className="font-extrabold">Penilaian diri: {unit?.code}</p>
        <label className="block"><span className="mono text-xs uppercase text-primary">Keyakinan</span>
          <select data-testid="select-confidence" className={field} value={conf} onChange={(e) => setConf(e.target.value as typeof conf)}>
            {Object.entries(confidenceText).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="flex items-center gap-3 text-sm"><input data-testid="check-learned" type="checkbox" className="h-5 w-5" checked={learned} onChange={(e) => setLearned(e.target.checked)} /> Saya sudah mempelajari unit ini</label>
        <label className="block"><span className="mono text-xs uppercase text-primary">Rencana belajar</span>
          <textarea data-testid="input-plan" rows={3} maxLength={3000} className={field} value={plan} onChange={(e) => setPlan(e.target.value)} /></label>
        <label className="block"><span className="mono text-xs uppercase text-primary">Alasan perubahan (3-2000)</span>
          <textarea data-testid="input-reason" rows={2} maxLength={2000} className={field} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <p className="text-xs text-muted-foreground">Setiap simpan menambah catatan riwayat baru; catatan sebelumnya tetap ada.</p>
        <Err m={err} />
        <button data-testid="button-save-assessment" disabled={m.isPending || !code || reason.trim().length < 3} className={btn}>{m.isPending ? 'Menyimpan…' : 'Simpan penilaian'}</button>
      </form>
    </div>
  );
}

function SafetyTab({ id, d, onDone }: { id: string; d: UjkJourneyDetail; onDone: (x?: UjkJourneyDetail) => void }) {
  const m = useCreateUjkSafetyAttempt();
  const [ans, setAns] = useState<(number | null)[]>([null, null, null]);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ passed: boolean; feedback: string[] } | null>(null);
  const qs = d.safetyQuestions.slice(0, 3);
  const ready = qs.length === 3 && ans.every((a) => a !== null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); if (!ready) return; setErr(null);
    m.mutate({ id, data: { answers: ans as number[] } }, {
      onSuccess: (r) => { setRes({ passed: r.passed, feedback: r.feedback }); onDone(r.detail); }, onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4" data-testid="form-safety">
      <div className="border-l-4 border-amber-400 bg-amber-400/10 p-3 text-sm text-amber-100">Gerbang K3 umum internal: ketiga jawaban harus benar. Rujukannya standar SMKK historis. Ini bukan tes resmi. Status sekarang: <b>{d.journey.safetyPassed ? 'lulus' : 'belum lulus'}</b>.</div>
      {qs.length < 3 ? <Empty title="Soal K3 belum tersedia" hint="Server belum menyediakan tiga soal untuk perjalanan ini." /> : qs.map((qn, i) => (
        <fieldset key={qn.id} className="space-y-2 border border-border bg-card p-4">
          <legend className="px-1 font-bold">{i + 1}. {qn.question}</legend>
          {qn.choices.map((c, ci) => (
            <label key={ci} className={`flex cursor-pointer items-start gap-3 border p-2 text-sm ${ans[i] === ci ? 'border-primary bg-primary/10' : 'border-border'}`}>
              <input type="radio" data-testid={`radio-k3-${i}-${ci}`} name={qn.id} checked={ans[i] === ci} onChange={() => setAns((a) => a.map((v, k) => (k === i ? ci : v)))} className="mt-1" />{c}</label>
          ))}
          <p className="mono text-[11px] text-muted-foreground">Sumber: {qn.sourceNote}</p>
        </fieldset>
      ))}
      <Err m={err} />
      {res && <div data-testid="panel-safety-result" className="panel-light p-4"><p className="font-extrabold">{res.passed ? 'Lulus gerbang internal' : 'Belum lulus'}</p><ul className="mt-1 list-disc pl-5 text-sm">{res.feedback.map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
      <button data-testid="button-submit-safety" disabled={!ready || m.isPending} className={btn}>{m.isPending ? 'Mengirim…' : 'Kirim jawaban K3'}</button>
    </form>
  );
}

function EvidenceTab({ id, d, onDone }: { id: string; d: UjkJourneyDetail; onDone: (x?: UjkJourneyDetail) => void }) {
  const reqUp = useRequestUjkEvidenceUpload();
  const create = useCreateUjkEvidence();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [unitCode, setUnitCode] = useState(d.units[0]?.code ?? '');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [c, setC] = useState({ valid: false, authentic: false, current: false, sufficient: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploadKey, setUploadKey] = useState('');
  const ticket = useRef<{ key: string; id: string; url: string; expires: number } | null>(null);
  const key = file ? `${id}|${file.name}|${file.size}|${file.type}|${unitCode}` : '';

  const pick = (f: File | null) => {
    setErr(null);
    if (f && !(ALLOWED as readonly string[]).includes(f.type)) { setErr('Hanya PDF, PNG, atau JPEG.'); return; }
    if (f && f.size > MAX) { setErr('Ukuran berkas maksimal 10 MB.'); return; }
    setFile(f); setUploadId(null); ticket.current = null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setErr(null); setBusy(true);
    try {
      let uid = uploadId && uploadKey === key ? uploadId : null;
      if (!uid) {
        if (!ticket.current || ticket.current.key !== key || ticket.current.expires <= Date.now()) {
          const r = await reqUp.mutateAsync({ id, data: { unitCode, name: file.name.slice(0, 200), size: file.size, contentType: file.type as (typeof ALLOWED)[number] } });
          ticket.current = { key, id: r.uploadId, url: r.uploadURL, expires: Date.now() + 14 * 60000 };
        }
        const put = await fetch(ticket.current.url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!put.ok) throw new Error(`Unggah berkas gagal (${put.status}). Coba lagi.`);
        uid = ticket.current.id; setUploadId(uid); setUploadKey(key);
      }
      const detail = await create.mutateAsync({ id, data: { uploadId: uid, title: title.trim(), description: desc.trim(), ...c } });
      void detail;
      setFile(null); setTitle(''); setDesc(''); setUploadId(null); ticket.current = null; setC({ valid: false, authentic: false, current: false, sufficient: false });
      if (fileRef.current) fileRef.current.value = '';
      onDone();
    } catch (x) {
      setErr(errMsg(x));
      if (typeof x === 'object' && x !== null && 'status' in x && x.status === 410) {
        setUploadId(null); ticket.current = null;
      }
    } finally { setBusy(false); }
  };

  const claims: [keyof typeof c, string][] = [['valid', 'Valid'], ['authentic', 'Asli'], ['current', 'Terkini'], ['sufficient', 'Memadai']];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <ul className="space-y-2" data-testid="list-evidence">
        {d.evidence.length === 0 ? <Empty title="Belum ada bukti" hint="Lampirkan foto atau dokumen kerja nyata untuk unit yang Anda klaim." /> : d.evidence.map((ev) => (
          <li key={ev.id} data-testid={`evidence-${ev.id}`} className="border border-border bg-card p-3 text-sm">
            <p className="mono text-xs text-primary">{ev.unitCode}</p>
            <p className="font-bold">{ev.title}</p>
            <p className="text-muted-foreground">{ev.description}</p>
            <p className="mono mt-1 text-[11px] text-muted-foreground">{ev.fileName} · {(ev.size / 1024).toFixed(0)} KB · {fmtDate(ev.createdAt)}</p>
            <p className="mono mt-1 text-[11px]">Klaim Anda: {claims.filter(([k]) => ev[k]).map(([, l]) => l).join(', ') || 'tidak ada'} · tinjauan manusia: {ev.reviewStatus === 'pending' ? 'belum ditinjau' : ev.reviewStatus === 'accepted' ? 'diterima' : 'ditolak'}{ev.reviewValidUntil ? ` · berlaku sampai ${new Date(ev.reviewValidUntil).toLocaleDateString('id-ID')}` : ''}{ev.reviewReason ? ` · ${ev.reviewReason}` : ''}</p>
            <a href={ev.downloadUrl} target="_blank" rel="noreferrer" data-testid={`link-download-${ev.id}`} className="mt-1 inline-flex items-center gap-1 font-bold text-primary"><Download className="h-4 w-4" /> Unduh (privat)</a>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="h-fit space-y-3 border-2 border-primary bg-card p-4" data-testid="form-evidence">
        <p className="font-extrabold">Tambah bukti</p>
        <p className="text-xs text-muted-foreground">Pernyataan di bawah adalah klaim Anda, bukan persetujuan peninjau. Berkas disimpan privat; jangan lampirkan NIK.</p>
        <label className="block"><span className="mono text-xs uppercase text-primary">Unit</span>
          <select data-testid="select-evidence-unit" className={field} value={unitCode} onChange={(e) => setUnitCode(e.target.value)}>{d.units.map((u) => <option key={u.code} value={u.code}>{u.code} - {u.title}</option>)}</select></label>
        <p className="text-xs leading-relaxed text-muted-foreground">Per akun: 20 permintaan/jam, 50 permintaan atau 100 MB/hari (reset UTC). Maksimal 5 unggahan tertunda atau 30 MB. URL unggah berlaku 15 menit; staging kedaluwarsa setelah 24 jam dan dibersihkan otomatis. Bukti tersimpan dan riwayat tidak ikut dihapus.</p>
        <label className="block"><span className="mono text-xs uppercase text-primary">Berkas (PDF/PNG/JPEG, maks 10 MB)</span>
          <input ref={fileRef} data-testid="input-evidence-file" type="file" accept="application/pdf,image/png,image/jpeg" className={field} onChange={(e) => pick(e.target.files?.[0] ?? null)} /></label>
        {file && <p className="mono text-xs"><FileUp className="inline h-3 w-3" /> {file.name} · {(file.size / 1024).toFixed(0)} KB{uploadId && uploadKey === key ? ' · sudah terunggah, percobaan ulang tidak mengunggah lagi' : ''}</p>}
        <label className="block"><span className="mono text-xs uppercase text-primary">Judul (3-200)</span><input data-testid="input-evidence-title" maxLength={200} className={field} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block"><span className="mono text-xs uppercase text-primary">Deskripsi (3-3000)</span><textarea data-testid="input-evidence-desc" rows={3} maxLength={3000} className={field} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2 text-sm">{claims.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input data-testid={`check-${k}`} type="checkbox" className="h-5 w-5" checked={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.checked })} /> Saya nyatakan {l.toLowerCase()}</label>)}</div>
        <Err m={err} />
        <button data-testid="button-submit-evidence" disabled={busy || !file || title.trim().length < 3 || desc.trim().length < 3} className={btn}>{busy ? 'Memproses…' : uploadId ? 'Coba simpan lagi' : 'Unggah dan simpan'}</button>
      </form>
    </div>
  );
}

function CorrectionTab({ id, onDone }: { id: string; onDone: (x?: UjkJourneyDetail) => void }) {
  const m = useCreateUjkCorrection();
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setOk(false);
    m.mutate({ id, data: { note: note.trim() } }, { onSuccess: () => { setNote(''); setOk(true); onDone(); }, onError: (x) => setErr(errMsg(x)) });
  };
  return (
    <form onSubmit={submit} className="max-w-2xl space-y-3 border-2 border-primary bg-card p-4" data-testid="form-correction">
      <p className="font-extrabold">Catatan koreksi</p>
      <p className="text-sm text-muted-foreground">Rekaman paspor tidak dapat disunting atau dihapus. Jika ada yang keliru, tulis koreksi beserta alasannya; catatan ditambahkan ke riwayat.</p>
      <textarea data-testid="input-correction" rows={5} maxLength={3000} className={field} value={note} onChange={(e) => setNote(e.target.value)} />
      <Err m={err} />
      {ok && <p data-testid="text-correction-ok" className="text-sm text-primary">Koreksi ditambahkan ke riwayat.</p>}
      <button data-testid="button-submit-correction" disabled={m.isPending || note.trim().length < 3} className={btn}>{m.isPending ? 'Menambahkan…' : 'Tambahkan koreksi'}</button>
    </form>
  );
}

function ReviewTab({ id, d, onDone }: { id: string; d: UjkJourneyDetail; onDone: (x?: UjkJourneyDetail) => void }) {
  const consent = useSetUjkReviewConsent();
  const sim = useSubmitUjkSimulation();
  const [report, setReport] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const r = d.review;
  const s = d.scheme;
  const required = d.units.filter((u) => d.requiredUnitCodes.includes(u.code));
  const reference = d.units.filter((u) => !d.requiredUnitCodes.includes(u.code));
  const setConsent = (v: boolean) => {
    if (r.assignmentId == null) return; setErr(null);
    consent.mutate({ id, data: { assignmentId: r.assignmentId, consent: v } }, { onSuccess: (x) => onDone(x), onError: (x) => setErr(errMsg(x)) });
  };
  const send = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    sim.mutate({ id, data: { report: report.trim() } }, { onSuccess: (x) => { setReport(''); onDone(x); }, onError: (x) => setErr(errMsg(x)) });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="panel-review-tab">
      <div className="space-y-4">
        <div className="border border-border bg-card p-4 text-sm" data-testid="panel-scheme">
          <p className="font-extrabold">Skema jabatan</p>
          {!s ? <p className="mt-1 text-muted-foreground">Belum ada skema terverifikasi. Kesiapan belum dapat dinyatakan sah.</p> : (
            <><p className="mono mt-1 text-xs">v{s.version} · {s.status === 'verified' ? 'terverifikasi' : s.status === 'unverified' ? 'menunggu verifikasi' : s.status === 'withdrawn' ? 'ditarik' : 'kedaluwarsa'} · {s.authority}</p>
              <p className="mono text-[11px] text-muted-foreground">Berlaku {s.validFrom ? new Date(s.validFrom).toLocaleDateString('id-ID') : 'Belum dikonfirmasi'} - {s.validUntil ? new Date(s.validUntil).toLocaleDateString('id-ID') : 'Belum dikonfirmasi'}</p>
              {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary underline">Sumber skema</a>}</>)}
          <p className="mt-2 text-xs text-muted-foreground">Kesiapan hanya menghitung unit wajib ({required.length}); unit rujukan ({reference.length}) bersifat latihan.</p>
        </div>
        <div className="space-y-2 border border-border bg-card p-4 text-sm" data-testid="panel-consent">
          <p className="font-extrabold">Peninjau dan persetujuan</p>
          {r.assignmentId == null ? <p className="text-muted-foreground">Belum ada peninjau ditugaskan. Anda tidak dapat menugaskan diri sendiri.</p> : (<>
            <p className="mono text-xs">Peninjau: {r.reviewerId} · persetujuan: {r.consent ? 'diberikan' : 'belum diberikan'}</p>
            <p className="text-xs text-muted-foreground">Peninjau baru bisa membuka bukti dan laporan Anda setelah Anda setuju. Anda dapat mencabut kapan saja.</p>
            <button data-testid="button-consent-toggle" disabled={consent.isPending} onClick={() => setConsent(!r.consent)} className={r.consent ? 'border-2 border-destructive px-4 py-2 font-bold text-destructive' : btn}>{r.consent ? 'Cabut persetujuan' : 'Setujui peninjauan'}</button></>)}
          <Err m={err} />
        </div>
        <div className="space-y-2 border border-border bg-card p-4 text-sm" data-testid="list-decisions">
          <p className="font-extrabold">Keputusan peninjau</p>
          {r.decisions.length === 0 ? <p className="text-muted-foreground">Belum ada keputusan.</p> : r.decisions.map((x) => <p key={x.id} className="border-l-2 border-primary pl-2"><span className="mono text-[11px] text-muted-foreground">{fmtDate(x.createdAt)} · {x.kind}</span><br />{x.reason}</p>)}
        </div>
      </div>
      <form onSubmit={send} className="h-fit space-y-3 border-2 border-primary bg-card p-4" data-testid="form-simulation">
        <p className="font-extrabold">Laporan simulasi</p>
        <p className="text-xs text-muted-foreground">Persetujuan simulasi gugur jika Anda menambah pekerjaan atau bukti, atau ada tinjauan bukti baru. Kirim ulang laporan setelah perubahan.</p>
        {r.simulationReport && <div className="border-l-4 border-primary bg-primary/10 p-2 text-xs"><p className="mono">Terkirim terakhir (#{r.simulationId}) · {d.simulationPassed ? 'diterima peninjau' : 'belum diterima'}</p><p className="mt-1 whitespace-pre-wrap">{r.simulationReport}</p>{r.simulationReason && <p className="mt-1">Alasan: {r.simulationReason}</p>}</div>}
        <textarea data-testid="input-simulation" rows={8} minLength={30} maxLength={10000} className={field} value={report} onChange={(e) => setReport(e.target.value)} placeholder="Ceritakan simulasi kerja yang Anda lakukan (minimal 30 karakter)" />
        <button data-testid="button-submit-simulation" disabled={sim.isPending || report.trim().length < 30} className={btn}>{sim.isPending ? 'Mengirim…' : 'Kirim laporan'}</button>
      </form>
    </div>
  );
}
