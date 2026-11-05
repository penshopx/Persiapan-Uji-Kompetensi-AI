import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Send, Trash2, ExternalLink } from 'lucide-react';
import { useGetCompetencyCatalog, useCreatePracticeTurn, getGetCompetencyCatalogQueryKey, getGetUjkPassportQueryKey, getGetUjkJourneyQueryKey } from '@workspace/api-client-react';
import { Disclaimer, Empty, ErrorBlock, Skeleton } from '@/components/bits';
import { useJourney, useSignedIn } from '@/hooks/use-ujk';
import { errMsg, uuid } from '@/lib/ujk';
import { useSelection, useSession, useStudyHistory, statusLabel, type Msg } from '@/lib/store';

type Mode = 'practice' | 'assessment';

export default function Practice() {
  const cat = useGetCompetencyCatalog({ query: { queryKey: getGetCompetencyCatalogQueryKey() } });
  const [selStored, setSel] = useSelection();
  const qc = useQueryClient();
  const params = new URLSearchParams(useSearch());
  const journeyId = params.get('journey');
  const unitParam = params.get('unit');
  const { signedIn } = useSignedIn();
  const jq = useJourney(journeyId ?? '');
  const lockedUnit = jq.data?.units.find((u) => u.code === unitParam);
  const locked = !!(journeyId && jq.data && lockedUnit);
  const sel = locked && jq.data && lockedUnit ? { roleId: jq.data.journey.roleId, unitCode: lockedUnit.code } : selStored;
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const [session, setSession] = useSession();
  const [hist, setHist] = useStudyHistory();
  const [mode, setMode] = useState<Mode>(session?.mode ?? 'practice');
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const turn = useCreatePracticeTurn();
  const endRef = useRef<HTMLDivElement>(null);

  const data = cat.data;
  const role = data?.roles.find((r) => r.id === sel?.roleId);
  const standard = data?.standards.find((s) => s.id === role?.standardId);
  const units = useMemo(() => data?.units.filter((u) => u.standardId === role?.standardId) ?? [], [data, role]);
  const unit = units.find((u) => u.code === sel?.unitCode);
  const active = session && sel && session.roleId === sel.roleId && session.unitCode === sel.unitCode && (session.journeyId ?? null) === (locked ? journeyId : null) ? session : null;
  const last = active?.result ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, turn.isPending]);

  const pickRole = (id: string) => {
    if (locked) return;
    const r = data?.roles.find((x) => x.id === id);
    const u = data?.units.find((x) => x.standardId === r?.standardId);
    setSel(id ? { roleId: id, unitCode: u?.code ?? '' } : null);
    setErr(null);
  };

  const run = (action: 'start' | 'answer') => {
    if (journeyId && !locked) return;
    if (!sel || !role?.practiceAvailable || !sel.unitCode) return;
    setErr(null);
    const prior: Msg[] = action === 'start' ? [] : messages.slice(-20);
    while (prior.reduce((total, message) => total + message.content.length, 0) > 30000) prior.shift();
    const text = answer.trim();
    if (action === 'answer' && !text) return;
    const base = { action, mode, roleId: sel.roleId, unitCode: sel.unitCode, history: prior, ...(action === 'answer' ? { answer: text } : {}) };
    const pk = JSON.stringify({ ...base, journeyId: locked ? journeyId : null });
    if (!attempt.current || attempt.current.key !== pk) attempt.current = { key: pk, id: uuid() };
    const payload = locked && journeyId ? { ...base, journeyId, attemptId: attempt.current.id } : base;
    turn.mutate({ data: payload }, {
      onSuccess: (res) => {
        attempt.current = null;
        if (locked && journeyId) {
          qc.invalidateQueries({ queryKey: getGetUjkPassportQueryKey() });
          qc.invalidateQueries({ queryKey: getGetUjkJourneyQueryKey(journeyId) });
          qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(`/api/ujk/journeys/${journeyId}/history/`) });
        }
        const reply = (res.response + (res.question ? `\n\n${res.question}` : '')).slice(0, 5000);
        const added: Msg[] = [...(action === 'answer' ? [{ role: 'user', content: text } as Msg] : []), { role: 'assistant', content: reply }];
        setSession({ journeyId: locked ? journeyId : null, roleId: sel.roleId, unitCode: sel.unitCode, mode, messages: [...prior, ...added].slice(-20), pendingQuestion: res.question, result: res });
        if (action === 'answer') {
          setHist((h) => [{ id: `${Date.now()}`, at: Date.now(), roleId: sel.roleId, unitCode: sel.unitCode, mode,
            question: active?.pendingQuestion ?? '', answer: text, score: res.evaluation?.score ?? null, status: res.evaluation?.status ?? null, nextStep: res.evaluation?.nextStep ?? null }, ...h].slice(0, 100));
        }
        setAnswer('');
      },
      onError: (e) => setErr(errMsg(e, 'Giliran latihan gagal diproses.')),
    });
  };

  const clearAll = () => { setHist([]); setSession(null); setAnswer(''); setConfirmClear(false); };
  const roleHist = hist.filter((h) => h.roleId === sel?.roleId);
  const field = 'w-full border-2 border-input bg-card px-3 py-3 outline-none focus:border-primary';

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="text-4xl font-extrabold tracking-tight">Latihan bersama agen</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Pilih peran dan unit, lalu jawab pertanyaan skenario. Evaluasi menyertakan bukti yang perlu Anda siapkan dan kutipan sumber.</p>
      </div>
      <Disclaimer />
      {journeyId && (
        <div data-testid="notice-journey" className="border-l-4 border-primary bg-primary/10 p-3 text-sm">
          {!signedIn ? 'Masuk untuk berlatih dalam perjalanan paspor Anda. Latihan umum tanpa paspor tetap tersedia di halaman ini tanpa parameter perjalanan.' :
            jq.isLoading ? 'Memuat perjalanan Anda…' :
            jq.isError ? <>Perjalanan tidak dapat dimuat: {errMsg(jq.error)} <button className="font-bold underline" onClick={() => jq.refetch()}>Coba lagi</button></> :
            !lockedUnit ? 'Unit pada tautan tidak ada dalam perjalanan ini. Buka kembali dari halaman paspor.' :
            <>Peran dan unit dikunci ke perjalanan Anda: <b>{lockedUnit.code}</b>. Giliran yang berhasil dicatat di paspor.</>}
        </div>
      )}
      {cat.isLoading ? <Skeleton rows={3} /> : cat.isError || !data ? <ErrorBlock onRetry={() => cat.refetch()} /> : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <div className="border border-border bg-card p-4 space-y-3">
              <label className="block"><span className="mono text-xs uppercase text-primary">Peran</span>
                <select data-testid="select-role" disabled={turn.isPending || locked} className={field} value={sel?.roleId ?? ''} onChange={(e) => pickRole(e.target.value)}>
                  <option value="">Pilih peran</option>
                  {data.classifications.filter((c) => c.practiceRoleCount > 0).map((c) => (
                    <optgroup key={c.id} label={c.name}>{data.roles.filter((r) => r.classificationId === c.id && r.practiceAvailable).map((r) => <option key={r.id} value={r.id}>{r.title} (J{r.level})</option>)}</optgroup>
                  ))}
                </select></label>
              <label className="block"><span className="mono text-xs uppercase text-primary">Unit rujukan</span>
                <select data-testid="select-unit" disabled={!role || turn.isPending || locked} className={field} value={sel?.unitCode ?? ''} onChange={(e) => sel && !locked && setSel({ ...sel, unitCode: e.target.value })}>
                  {units.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.title}</option>)}
                </select></label>
              <div className="grid grid-cols-2 gap-px bg-border border border-border" role="group">
                {(['practice', 'assessment'] as Mode[]).map((m) => (
                  <button key={m} disabled={turn.isPending} data-testid={`button-mode-${m}`} onClick={() => setMode(m)} className={`py-2 text-sm font-bold ${mode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>{m === 'practice' ? 'Latihan' : 'Simulasi asesmen'}</button>
                ))}
              </div>
              {unit && <p className="text-xs text-muted-foreground">{unit.sourceNote}</p>}
              <p className="text-xs text-muted-foreground">Hanya jabatan dengan unit sumber yang sudah diproses tersedia di pilihan latihan. Seluruh entri lainnya dapat ditelusuri di katalog.</p>
              {standard && <div className="border-l-2 border-amber-400 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-100"><b>{standard.status}</b><p className="mt-1">{standard.statusNote}</p></div>}
              <button data-testid="button-start" disabled={(!!journeyId && !locked) || !role?.practiceAvailable || !sel?.unitCode || turn.isPending} onClick={() => run('start')} className="w-full bg-primary px-4 py-3 font-bold text-primary-foreground transition-transform active:scale-[.98] disabled:opacity-40">
                {turn.isPending ? 'Agen sedang memproses…' : active ? 'Mulai ulang sesi' : 'Mulai sesi'}
              </button>
              <p data-testid="text-ai-notice" className="mono text-[11px] leading-relaxed text-muted-foreground">Setiap giliran memakai AI dan ditagihkan ke kredit Replit.</p>
            </div>

            <div className="border border-border bg-card p-4">
              <div className="flex items-center justify-between"><p className="font-extrabold">Riwayat belajar (lokal peramban)</p><span className="mono text-xs text-muted-foreground">{hist.length} catatan</span></div>
              {hist.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Belum ada jawaban tercatat. Riwayat tersimpan di peramban ini.</p> : (
                <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto" data-testid="list-history">
                  {hist.slice(0, 15).map((h) => (
                    <li key={h.id} className="border-l-2 border-primary pl-3 text-sm">
                      <p className="mono text-[11px] text-muted-foreground">{new Date(h.at).toLocaleString('id-ID')} · {h.unitCode}</p>
                      <p>{h.status ? statusLabel[h.status] : 'Tanpa evaluasi'}{h.score != null && ` · skor ${h.score}`}</p>
                    </li>
                  ))}
                </ul>
              )}
              {(hist.length > 0 || active) && (confirmClear ? (
                <div className="mt-3 border border-destructive p-3 text-sm" data-testid="confirm-clear">
                  <p>Hapus seluruh riwayat dan sesi aktif? Tindakan ini tidak bisa dibatalkan.</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={clearAll} data-testid="button-confirm-clear" className="bg-destructive px-3 py-1.5 font-bold text-destructive-foreground">Ya, hapus</button>
                    <button onClick={() => setConfirmClear(false)} data-testid="button-cancel-clear" className="border border-border px-3 py-1.5 font-bold">Batal</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmClear(true)} data-testid="button-clear-history" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-destructive"><Trash2 className="h-4 w-4" /> Hapus riwayat peramban</button>
              ))}
            </div>
          </div>

          <div className="min-h-[420px] border border-border bg-card/60 p-4 md:p-5">
            {err && !active && <div className="mb-4"><ErrorBlock message={err} onRetry={() => run('start')} /></div>}
            {!role ? (
              <Empty title="Belum ada peran dipilih" hint="Pilih peran di panel kiri, atau buka katalog dan tekan Latih pada unit yang diinginkan." />
            ) : !active ? (
              <Empty title={role.title} hint={`Unit ${sel?.unitCode || '-'} siap. ${roleHist.length ? `Anda punya ${roleHist.length} catatan untuk peran ini.` : 'Tekan Mulai sesi untuk menerima pertanyaan pertama.'}`} />
            ) : (
              <div className="space-y-4" data-testid="chat-thread">
                {messages.map((m, i) => (
                  <div key={i} className={`rise max-w-[92%] whitespace-pre-wrap p-4 text-[15px] leading-relaxed ${m.role === 'user' ? 'ml-auto bg-secondary text-secondary-foreground' : 'border-l-4 border-primary bg-muted'}`} data-testid={`msg-${m.role}-${i}`}>
                    <p className="mono mb-1 text-[11px] uppercase opacity-70">{m.role === 'user' ? 'Jawaban Anda' : 'Agen'}</p>{m.content}
                  </div>
                ))}
                {turn.isPending && <div className="skel h-20 max-w-[70%]" data-testid="state-pending" />}
                {err && <ErrorBlock message={err} onRetry={() => run(messages.length > 1 && answer.trim() ? 'answer' : 'start')} />}
                {last?.evaluation && (
                  <div className="rise panel-light p-4" data-testid="panel-evaluation">
                    <div className="flex flex-wrap items-end gap-4"><span className="mono text-5xl font-semibold">{last.evaluation.score}</span><span className="pb-1 font-extrabold">{statusLabel[last.evaluation.status]}</span></div>
                    <p className="mt-2 text-xs">Estimasi mutu jawaban teks ini, bukan nilai kelulusan atau penetapan kompetensi resmi.</p>
                    <div className="mt-3 grid gap-4 md:grid-cols-3 text-sm">
                      {([['Kekuatan', last.evaluation.strengths], ['Celah', last.evaluation.gaps], ['Bukti yang disiapkan', last.evaluation.evidenceChecklist]] as [string, string[]][]).map(([t, l]) => (
                        <div key={t}><p className="font-extrabold">{t}</p><ul className="mt-1 list-disc pl-4">{l.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                      ))}
                    </div>
                    <p className="mt-3 text-sm"><b>Langkah berikut:</b> {last.evaluation.nextStep}</p>
                  </div>
                )}
                {last && last.citations.length > 0 && (
                  <div data-testid="list-citations"><p className="mono text-xs uppercase text-primary">Kutipan sumber</p>
                    {last.citations.map((c, i) => (
                      <a key={i} href={c.url} target="_blank" rel="noreferrer" className="mt-2 block border border-border p-3 text-sm hover:border-primary">
                        <span className="font-bold">{c.title}</span> <span className="mono text-xs text-primary">{c.unitCode}</span> <ExternalLink className="inline h-3 w-3" />
                        <span className="block text-muted-foreground">{c.note}</span></a>
                    ))}
                  </div>
                )}
                {last && last.agentRuns.length > 0 && (
                  <div className="flex flex-wrap gap-2" data-testid="list-agentruns">
                    {last.agentRuns.map((a) => <span key={a.agentId} title={a.responsibility} className={`mono border px-2 py-1 text-[11px] ${a.status === 'complete' ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>{a.agentName}: {a.status === 'complete' ? 'selesai' : 'dilewati'}{a.status === 'complete' ? ` · ${a.runtime === 'hermes' ? 'Hermes' : a.runtime === 'openai' ? 'OpenAI' : a.runtime === 'local' ? 'lokal' : 'runtime tidak tercatat'}` : ''}</span>)}
                  </div>
                )}
                <div ref={endRef} />
                <form onSubmit={(e) => { e.preventDefault(); run('answer'); }} className="sticky bottom-2 space-y-2 bg-background/90 p-1 backdrop-blur">
                  <textarea data-testid="input-answer" value={answer} maxLength={5000} onChange={(e) => setAnswer(e.target.value)} rows={4} placeholder="Tulis jawaban Anda: langkah kerja, K3, bukti, dan dasar standar." className={field} />
                  <div className="flex items-center justify-between gap-3">
                    <span className="mono text-xs text-muted-foreground">{answer.length}/5000 · AI ditagihkan ke kredit Replit</span>
                    <button data-testid="button-send" type="submit" disabled={turn.isPending || !answer.trim()} className="inline-flex items-center gap-2 bg-primary px-5 py-2.5 font-bold text-primary-foreground disabled:opacity-40"><Send className="h-4 w-4" /> Kirim jawaban</button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
