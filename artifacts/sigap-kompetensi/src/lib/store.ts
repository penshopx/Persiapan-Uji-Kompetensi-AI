import { useCallback, useEffect, useState } from 'react';
import type { PracticeTurnResponse } from '@workspace/api-client-react';
import { toast } from '@/hooks/use-toast';

export type Msg = { role: 'user' | 'assistant'; content: string };
export type Selection = { roleId: string; unitCode: string };
export type StudyEntry = {
  id: string; at: number; roleId: string; unitCode: string; mode: 'practice' | 'assessment';
  question: string; answer: string; score: number | null; status: string | null; nextStep: string | null;
};

const EVT = 'sigap-store';
export function usePersisted<T>(key: string, init: T): [T, (v: T | ((p: T) => T)) => void] {
  const read = (): T => {
    try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : init; } catch { return init; }
  };
  const [val, setVal] = useState<T>(read);
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent).detail === key) setVal(read()); };
    const sync = (e: StorageEvent) => { if (e.key === key) setVal(read()); };
    window.addEventListener(EVT, h);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVT, h);
      window.removeEventListener('storage', sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((v: T | ((p: T) => T)) => {
    let cur: T; try { const r = localStorage.getItem(key); cur = r ? JSON.parse(r) : init; } catch { cur = init; }
    const next = typeof v === 'function' ? (v as (p: T) => T)(cur) : v;
    setVal(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(EVT, { detail: key }));
    } catch {
      toast({ title: 'Riwayat tidak tersimpan', description: 'Penyimpanan peramban tidak tersedia atau penuh. Catatan pada tab ini dapat hilang setelah ditutup.', variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [val, set];
}

export const useSelection = () => usePersisted<Selection | null>('sigap.selection', null);
export const useStudyHistory = () => usePersisted<StudyEntry[]>('sigap.history', []);
export type Session = { roleId: string; unitCode: string; mode: 'practice' | 'assessment'; messages: Msg[]; pendingQuestion: string | null; result?: PracticeTurnResponse } | null;
export const useSession = () => usePersisted<Session>('sigap.session', null);

export const statusLabel: Record<string, string> = {
  needs_practice: 'Perlu latihan', developing: 'Berkembang', ready_for_practice: 'Siap berlatih lanjut',
};
