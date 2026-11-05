import { useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import {
  useGetUjkReviewWorkspace, usePublishUjkScheme, useAssignUjkReviewer, useGetUjkReviewCase, useCreateUjkReview,
  useGetCompetencyCatalog, getGetUjkReviewWorkspaceQueryKey, getGetUjkReviewCaseQueryKey, getGetUjkJourneyQueryKey,
  type UjkJourneyDetail, type UjkEvidence, type UjkScheme, type UjkSchemeInputStatus,
} from '@workspace/api-client-react';
import { Empty, ErrorBlock, Skeleton } from '@/components/bits';
import { errMsg, fmtDate } from '@/lib/ujk';

const field = 'w-full border-2 border-input bg-card px-3 py-2 outline-none focus:border-primary';
const btn = 'bg-primary px-5 py-2.5 font-bold text-primary-foreground disabled:opacity-40';
const POLL = 30_000;
const Err = ({ m }: { m: string | null }) => (m ? <p role="alert" data-testid="text-review-error" className="border border-destructive/60 bg-destructive/10 p-3 text-sm">{m}</p> : null);
const schemeLabel: Record<string, string> = { verified: 'Terverifikasi', unverified: 'Belum terverifikasi (menunggu)', withdrawn: 'Ditarik', expired: 'Kedaluwarsa' };
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('id-ID', { dateStyle: 'medium' }) : 'Belum dikonfirmasi');

export default function Review() {
  const { id } = useParams<{ id?: string }>();
  return id ? <CaseView id={id} /> : <Workspace />;
}

function Workspace() {
  const q = useGetUjkReviewWorkspace({ query: { queryKey: getGetUjkReviewWorkspaceQueryKey(), refetchInterval: POLL, refetchOnMount: 'always', staleTime: 0 } });
  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.isError || !q.data) return <ErrorBlock message={errMsg(q.error)} onRetry={() => q.refetch()} />;
  const w = q.data;
  return (
    <div className="space-y-8">
      <div className="rise">
        <p className="mono text-xs uppercase text-primary">Tinjauan manusia</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight md:text-4xl">Ruang tinjauan</h1>
        <Link href="/notifikasi" className="mt-2 inline-block text-sm font-bold text-primary">Pemberitahuan penugasan dan masa berlaku</Link>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Peninjau hanya melihat kasus yang ditugaskan dan disetujui pemilik. Status skema di bawah adalah catatan internal; tidak ada persetujuan resmi LSP atau BNSP yang diklaim di sini. {w.manager ? 'Akun Anda bertanda pengelola (ditentukan server).' : ''}</p>
      </div>
      <section data-testid="list-review-cases" className="space-y-2">
        <h2 className="text-xl font-extrabold">Kasus</h2>
        {w.cases.length === 0 ? <Empty title="Belum ada kasus" hint={w.manager ? 'Belum ada perjalanan terdaftar.' : 'Belum ada kasus yang ditugaskan kepada Anda.'} /> : w.cases.map((c) => (
          <div key={c.id} data-testid={`case-${c.id}`} className="border border-border bg-card p-3 text-sm">
            <p className="mono text-xs text-primary">{c.roleId}</p>
            <p className="font-bold">{c.title}</p>
            <p className="mono text-[11px] text-muted-foreground">Peninjau: {c.reviewerId ?? 'belum ditugaskan'} · persetujuan pemilik: {c.consent ? 'diberikan' : 'belum'}</p>
            {c.canReview && <Link href={`/review/${c.id}`} data-testid={`link-case-${c.id}`} className="mt-1 inline-block font-bold text-primary">Buka kasus</Link>}
            {w.manager && <Assign key={`${c.id}-${c.reviewerId ?? ''}`} caseId={c.id} current={c.reviewerId} />}
          </div>
        ))}
      </section>
      {w.manager && <Schemes schemes={w.schemes} />}
    </div>
  );
}

function Assign({ caseId, current }: { caseId: string; current: string | null }) {
  const m = useAssignUjkReviewer();
  const qc = useQueryClient();
  const [rid, setRid] = useState(current ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    m.mutate({ id: caseId, data: { reviewerId: rid.trim(), reason: reason.trim() } }, {
      onSuccess: (w) => { qc.setQueryData(getGetUjkReviewWorkspaceQueryKey(), w); setReason(''); }, onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <form onSubmit={go} className="mt-2 grid gap-2 border-t border-border pt-2 md:grid-cols-[1fr_1fr_auto]" data-testid={`form-assign-${caseId}`}>
      <input data-testid={`input-reviewer-${caseId}`} className={field} placeholder="ID Clerk peninjau (kosong = cabut)" value={rid} onChange={(e) => setRid(e.target.value)} />
      <input data-testid={`input-assign-reason-${caseId}`} className={field} placeholder="Alasan (3-2000)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button data-testid={`button-assign-${caseId}`} disabled={m.isPending || reason.trim().length < 3} className={btn}>{rid.trim() ? 'Tugaskan' : 'Cabut'}</button>
      <div className="md:col-span-3"><Err m={err} /></div>
    </form>
  );
}

function Schemes({ schemes }: { schemes: UjkScheme[] }) {
  const cat = useGetCompetencyCatalog();
  const pub = usePublishUjkScheme();
  const qc = useQueryClient();
  const [roleId, setRoleId] = useState('');
  const [f, setF] = useState({ version: '', authority: '', sourceUrl: '', sourceHash: '', sourceLocator: '', validFrom: '', validUntil: '', reason: '' });
  const [status, setStatus] = useState<UjkSchemeInputStatus>('unverified');
  const [codes, setCodes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const roles = cat.data?.roles ?? [];
  const role = roles.find((r) => r.id === roleId);
  const units = useMemo(() => {
    const std = role?.standardId;
    return (cat.data?.units ?? []).filter((u) => u.standardId === std);
  }, [cat.data, role]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const hashOk = /^[a-f0-9]{64}$/.test(f.sourceHash);
  const valid = !!roleId && hashOk && f.sourceUrl.trim() && f.version.trim() && f.authority.trim().length >= 3 && f.sourceLocator.trim().length >= 3 && f.reason.trim().length >= 10 && (status !== 'verified' || (!!f.validFrom && !!f.validUntil && codes.length > 0));
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    pub.mutate({ data: { roleId, ...f, version: f.version.trim(), authority: f.authority.trim(), sourceUrl: f.sourceUrl.trim(), sourceLocator: f.sourceLocator.trim(), reason: f.reason.trim(), status, unitCodes: codes,
      validFrom: f.validFrom ? new Date(f.validFrom).toISOString() : null, validUntil: f.validUntil ? new Date(f.validUntil).toISOString() : null } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetUjkReviewWorkspaceQueryKey() }); qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/api/ujk/') }); setF({ ...f, reason: '', version: '' }); },
      onError: (x) => setErr(errMsg(x)),
    });
  };
  return (
    <section className="space-y-4" data-testid="section-schemes">
      <h2 className="text-xl font-extrabold">Revisi skema</h2>
      <p className="text-sm text-muted-foreground">Revisi hanya ditambahkan, tidak menimpa. Hanya status terverifikasi yang dihitung sebagai skema sah; status menunggu tetap belum terverifikasi.</p>
      <p className="text-xs text-muted-foreground">Tanggal berlaku wajib untuk verifikasi. Untuk sumber belum terverifikasi atau ditarik, biarkan tanggal kosong bila belum dikonfirmasi; jangan mengarang periode berlaku.</p>
      {schemes.length === 0 ? <Empty title="Belum ada revisi skema" hint="Tambahkan revisi pertama di formulir di bawah." /> : (
        <ul className="space-y-2">{schemes.map((s) => (
          <li key={s.id} data-testid={`scheme-${s.id}`} className="border border-border bg-card p-3 text-sm">
            <p className="mono text-xs text-primary">{s.roleId} · v{s.version} · {schemeLabel[s.status]}</p>
            <p className="font-bold">{s.authority}</p>
            <p className="mono text-[11px] text-muted-foreground">Berlaku {day(s.validFrom)} - {day(s.validUntil)} · {s.unitCodes.length} unit wajib · dicek {fmtDate(s.checkedAt)} oleh {s.checkedBy}</p>
            <p className="mono break-all text-[11px] text-muted-foreground">sha256 {s.sourceHash} · {s.sourceLocator}</p>
            {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary underline">Sumber</a>}
            <p className="mt-1 text-xs">{s.reason}</p>
          </li>))}</ul>
      )}
      <form onSubmit={submit} data-testid="form-scheme" className="grid gap-3 border-2 border-primary bg-card p-4 md:grid-cols-2">
        <p className="font-extrabold md:col-span-2">Tambah revisi skema</p>
        <label className="block"><span className="mono text-xs uppercase text-primary">Jabatan</span>
          <select data-testid="select-scheme-role" className={field} value={roleId} onChange={(e) => { setRoleId(e.target.value); setCodes([]); }}>
            <option value="">Pilih jabatan</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.title} (J{r.level})</option>)}</select></label>
        <label className="block"><span className="mono text-xs uppercase text-primary">Status</span>
          <select data-testid="select-scheme-status" className={field} value={status} onChange={(e) => setStatus(e.target.value as UjkSchemeInputStatus)}>
            <option value="unverified">Belum terverifikasi</option><option value="verified">Terverifikasi</option><option value="withdrawn">Ditarik</option></select></label>
        <label className="block"><span className="mono text-xs uppercase text-primary">Versi</span><input data-testid="input-scheme-version" className={field} value={f.version} onChange={set('version')} /></label>
        <label className="block"><span className="mono text-xs uppercase text-primary">Otoritas</span><input data-testid="input-scheme-authority" className={field} value={f.authority} onChange={set('authority')} /></label>
        <label className="block"><span className="mono text-xs uppercase text-primary">URL sumber</span><input data-testid="input-scheme-url" className={field} value={f.sourceUrl} onChange={set('sourceUrl')} /></label>
        <label className="block"><span className="mono text-xs uppercase text-primary">Lokasi di sumber</span><input data-testid="input-scheme-locator" className={field} value={f.sourceLocator} onChange={set('sourceLocator')} /></label>
        <label className="block md:col-span-2"><span className="mono text-xs uppercase text-primary">Hash sumber sha256 (64 heksadesimal huruf kecil)</span><input data-testid="input-scheme-hash" className={`${field} mono`} value={f.sourceHash} onChange={set('sourceHash')} />{f.sourceHash && !hashOk && <span className="text-xs text-destructive">Format hash tidak valid.</span>}</label>
        <label className="block"><span className="mono text-xs uppercase text-primary">Berlaku dari</span><input data-testid="input-scheme-from" type="date" className={field} value={f.validFrom} onChange={set('validFrom')} /></label>
        <label className="block"><span className="mono text-xs uppercase text-primary">Berlaku sampai</span><input data-testid="input-scheme-until" type="date" className={field} value={f.validUntil} onChange={set('validUntil')} /></label>
        <fieldset className="md:col-span-2"><legend className="mono text-xs uppercase text-primary">Unit wajib ({codes.length}) - dari katalog jabatan</legend>
          {!role ? <p className="text-sm text-muted-foreground">Pilih jabatan terlebih dahulu.</p> : units.length === 0 ? <p className="text-sm text-muted-foreground">Katalog tidak memuat unit untuk standar jabatan ini.</p> : (
            <div className="mt-1 grid max-h-56 gap-1 overflow-y-auto border border-border p-2 text-sm">{units.map((u) => (
              <label key={u.code} className="flex items-start gap-2"><input type="checkbox" data-testid={`check-scheme-unit-${u.code}`} className="mt-1 h-4 w-4" checked={codes.includes(u.code)} onChange={(e) => setCodes(e.target.checked ? [...codes, u.code] : codes.filter((c) => c !== u.code))} /><span><span className="mono text-xs">{u.code}</span> {u.title}</span></label>))}</div>)}
        </fieldset>
        <label className="block md:col-span-2"><span className="mono text-xs uppercase text-primary">Alasan (10-3000)</span><textarea data-testid="input-scheme-reason" rows={3} className={field} value={f.reason} onChange={set('reason')} /></label>
        <div className="space-y-2 md:col-span-2"><Err m={err} /><button data-testid="button-publish-scheme" disabled={pub.isPending || !valid} className={btn}>{pub.isPending ? 'Menyimpan…' : 'Tambahkan revisi'}</button></div>
      </form>
    </section>
  );
}

function CaseView({ id }: { id: string }) {
  const q = useGetUjkReviewCase(id, { query: { queryKey: getGetUjkReviewCaseQueryKey(id), refetchInterval: POLL, refetchOnMount: 'always', staleTime: 0, retry: false } });
  const qc = useQueryClient();
  const refresh = (d?: UjkJourneyDetail) => { if (d) qc.setQueryData(getGetUjkReviewCaseQueryKey(id), d); qc.invalidateQueries({ queryKey: getGetUjkReviewCaseQueryKey(id) }); qc.invalidateQueries({ queryKey: getGetUjkReviewWorkspaceQueryKey() }); qc.invalidateQueries({ queryKey: getGetUjkJourneyQueryKey(id) }); };
  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.isError || !q.data) return <ErrorBlock message={errMsg(q.error, 'Kasus tidak tersedia. Anda harus ditugaskan dan pemilik harus menyetujui.')} onRetry={() => q.refetch()} />;
  const d = q.data;
  const r = d.review;
  return (
    <div className="space-y-6">
      <Link href="/review" data-testid="link-back-review" className="mono text-xs uppercase text-primary">&larr; Ruang tinjauan</Link>
      <h1 className="text-3xl font-extrabold tracking-tight">{d.journey.title}</h1>
      <p className="mono text-xs text-muted-foreground">Skema: {d.scheme ? `${schemeLabel[d.scheme.status]} v${d.scheme.version}` : 'belum ada'} · unit wajib {d.requiredUnitCodes.length}</p>
      <section className="space-y-2" data-testid="list-review-evidence">
        <h2 className="text-xl font-extrabold">Bukti</h2>
        {d.evidence.length === 0 ? <Empty title="Belum ada bukti" hint="Pemilik belum mengunggah bukti." /> : d.evidence.map((ev) => <EvidenceReview key={ev.id} id={id} ev={ev} lastEventId={r.lastEventId} onDone={refresh} />)}
      </section>
      <section className="space-y-2 border border-border bg-card p-4" data-testid="panel-review-simulation">
        <h2 className="text-xl font-extrabold">Simulasi</h2>
        {r.simulationId == null || !r.simulationReport ? <p className="text-sm text-muted-foreground">Pemilik belum mengirim laporan simulasi.</p> : (<>
          <p className="mono text-xs text-muted-foreground">Simulasi #{r.simulationId} · status: {d.simulationPassed ? 'diterima' : 'belum diterima'}</p>
          <p className="whitespace-pre-wrap text-sm">{r.simulationReport}</p>
          {r.simulationAttempts.length > 0 && (
            <div className="space-y-2" data-testid="list-simulation-attempts">
              <p className="mono text-xs uppercase text-primary">Jawaban latihan nyata saat pengiriman</p>
              {r.simulationAttempts.map((a) => (
                <div key={a.id} className="border-l-2 border-primary bg-background p-2 text-sm">
                  <p className="mono text-[11px] text-muted-foreground">#{a.id} · {fmtDate(a.createdAt)}{a.unitCode ? ` · ${a.unitCode}` : ''}{a.score != null ? ` · skor AI ${a.score}` : ''}</p>
                  {a.question && <p className="mt-1 text-muted-foreground">T: {a.question}</p>}
                  {a.answer && <p className="mt-1 whitespace-pre-wrap">J: {a.answer}</p>}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Persetujuan simulasi gugur bila pemilik menambah pekerjaan atau bukti, atau ada tinjauan bukti baru. Kirim ulang dan tinjau lagi setelah perubahan.</p>
          {r.simulationReason && <p className="text-sm text-muted-foreground">Alasan keputusan terakhir: {r.simulationReason}</p>}
          <ReviewForm id={id} kind="simulation_review" simulationId={r.simulationId} lastEventId={r.lastEventId} onDone={refresh} />
        </>)}
      </section>
      <section data-testid="list-review-decisions" className="space-y-2">
        <h2 className="text-xl font-extrabold">Keputusan</h2>
        {r.decisions.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada keputusan.</p> : r.decisions.map((x) => (
          <p key={x.id} className="border-l-2 border-primary bg-card p-2 text-sm"><span className="mono text-[11px] text-muted-foreground">#{x.id} · {fmtDate(x.createdAt)} · {x.kind} · {x.actorId}</span><br />{x.reason}</p>))}
      </section>
    </div>
  );
}

function EvidenceReview({ id, ev, lastEventId, onDone }: { id: string; ev: UjkEvidence; lastEventId: number; onDone: (d?: UjkJourneyDetail) => void }) {
  return (
    <div data-testid={`review-evidence-${ev.id}`} className="space-y-1 border border-border bg-card p-3 text-sm">
      <p className="mono text-xs text-primary">{ev.unitCode}</p>
      <p className="font-bold">{ev.title}</p><p className="text-muted-foreground">{ev.description}</p>
      <p className="mono text-[11px] text-muted-foreground">{ev.fileName} · {(ev.size / 1024).toFixed(0)} KB · klaim pemilik: {['valid', 'authentic', 'current', 'sufficient'].filter((k) => ev[k as 'valid']).join(', ') || 'tidak ada'}</p>
      <a href={ev.downloadUrl} target="_blank" rel="noreferrer" data-testid={`link-review-download-${ev.id}`} className="inline-flex items-center gap-1 font-bold text-primary"><Download className="h-4 w-4" /> Unduh (privat)</a>
      <p className="mono text-[11px]">Tinjauan: {ev.reviewStatus === 'pending' ? 'belum ditinjau' : ev.reviewStatus === 'accepted' ? 'diterima' : 'ditolak'}{ev.reviewValidUntil ? ` · berlaku sampai ${day(ev.reviewValidUntil)}` : ''}{ev.reviewReason ? ` · ${ev.reviewReason}` : ''}</p>
      <ReviewForm id={id} kind="evidence_review" evidenceId={ev.id} lastEventId={lastEventId} onDone={onDone} />
    </div>
  );
}

function ReviewForm({ id, kind, evidenceId, simulationId, lastEventId, onDone }: { id: string; kind: 'evidence_review' | 'simulation_review'; evidenceId?: string; simulationId?: number; lastEventId: number; onDone: (d?: UjkJourneyDetail) => void }) {
  const m = useCreateUjkReview();
  const key = evidenceId ?? `sim-${simulationId}`;
  const [c, setC] = useState({ valid: false, authentic: false, current: false, sufficient: false });
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = (accepted: boolean) => {
    setErr(null);
    m.mutate({ id, data: { kind, evidenceId, simulationId, expectedEventId: reviewedEventId, accepted, ...c, validUntil: new Date(until).toISOString(), reason: reason.trim() } }, {
      onSuccess: (d) => { setReason(''); setReviewedEventId(d.review.lastEventId); onDone(d); }, onError: (x) => setErr(errMsg(x)),
    });
  };
  const [reviewedEventId, setReviewedEventId] = useState(lastEventId);
  const changed = reviewedEventId !== lastEventId;
  const ok = !!until && reason.trim().length >= 10 && !m.isPending && !changed;
  const labels: [keyof typeof c, string][] = [['valid', 'Valid'], ['authentic', 'Asli'], ['current', 'Terkini'], ['sufficient', 'Memadai']];
  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2" data-testid={`form-review-${key}`}>
      {changed && <div role="alert" className="border border-amber-400 p-3 text-sm">
        <p>Kasus berubah sejak formulir dibuka. Tinjau data terbaru sebelum membuat keputusan; isian sebelumnya belum dikirim.</p>
        <button type="button" className="mt-2 font-bold text-primary" onClick={() => { setReviewedEventId(lastEventId); setC({ valid: false, authentic: false, current: false, sufficient: false }); setReason(''); }}>Mulai tinjauan kondisi terbaru</button>
      </div>}
      <div className="flex flex-wrap gap-4">{labels.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" data-testid={`check-review-${k}-${key}`} className="h-4 w-4" checked={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.checked })} /> {l}</label>)}</div>
      <div className="grid gap-2 md:grid-cols-[200px_1fr]">
        <input type="date" data-testid={`input-review-until-${key}`} className={field} value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Berlaku sampai" />
        <input data-testid={`input-review-reason-${key}`} className={field} placeholder="Alasan keputusan (10-3000)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Err m={err} />
      <div className="flex gap-2">
        <button type="button" data-testid={`button-accept-${key}`} disabled={!ok || !Object.values(c).every(Boolean)} onClick={() => go(true)} className={btn}>Terima</button>
        <button type="button" data-testid={`button-reject-${key}`} disabled={!ok} onClick={() => go(false)} className="border-2 border-destructive px-5 py-2 font-bold text-destructive disabled:opacity-40">Tolak</button>
      </div>
      <p className="text-[11px] text-muted-foreground">Penerimaan memerlukan keempat penilaian V/A/C/S. Jika ada perubahan baru dari pemilik, server menolak dan data dimuat ulang.</p>
    </div>
  );
}
