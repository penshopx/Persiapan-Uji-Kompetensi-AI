import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetUjkNotifications, getGetUjkNotificationsQueryKey,
  readUjkNotification, openUjkNotification, type UjkNotification,
} from '@workspace/api-client-react';
import { Empty, ErrorBlock, Skeleton } from '@/components/bits';
import { errMsg, fmtDate } from '@/lib/ujk';

export function NotificationNav() {
  const { isSignedIn, userId } = useAuth();
  const q = useGetUjkNotifications(undefined, { query: {
    queryKey: [...getGetUjkNotificationsQueryKey(), userId], enabled: !!isSignedIn,
    refetchInterval: 30_000, refetchOnMount: 'always', refetchOnWindowFocus: true, staleTime: 0,
  } });
  if (!isSignedIn) return null;
  return <span aria-live="polite">{q.data ? ` (${q.data.unreadCount})` : q.isError ? ' (!)' : ''}</span>;
}

export default function Notifications() {
  const { userId } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [before, setBefore] = useState<string>();
  const [previous, setPrevious] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useGetUjkNotifications(before ? { before } : undefined, { query: {
    queryKey: [...getGetUjkNotificationsQueryKey(before ? { before } : undefined), userId],
    refetchInterval: 30_000, refetchOnMount: 'always', refetchOnWindowFocus: true, staleTime: 0,
  } });
  useEffect(() => { document.title = 'Pemberitahuan — SIGAP Kompetensi'; }, []);
  const refresh = () => qc.invalidateQueries({ queryKey: getGetUjkNotificationsQueryKey() });
  const act = async (item: UjkNotification, open: boolean) => {
    setBusy(item.id); setError(null);
    try {
      // Resolve at click time, never navigate to an old cached destination.
      const destination = open ? await openUjkNotification(item.id) : null;
      await readUjkNotification(item.id);
      await refresh();
      if (destination) {
        // Drop old case data, including data from a prior consent grant.
        qc.removeQueries({ predicate: x => String(x.queryKey[0]).startsWith('/api/ujk/journeys/') });
        navigate(destination.href);
      }
    } catch (e) { setError(errMsg(e, 'Pemberitahuan belum dapat dibuka. Izin kasus mungkin telah berubah.')); void refresh(); }
    finally { setBusy(null); }
  };
  return (
    <div className="space-y-5">
      <header>
        <p className="mono text-xs uppercase text-primary">Kotak masuk akun</p>
        <h1 className="mt-1 text-3xl font-extrabold">Pemberitahuan</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Penugasan, persetujuan akses, penolakan, dan batas masa berlaku. Pengingat tidak memperpanjang persetujuan atau mengaktifkan kesiapan. Pesan tetap tersimpan; akses kasus selalu diperiksa kembali.</p>
      </header>
      {error && <p role="alert" className="border border-destructive p-3 text-sm">{error}</p>}
      {q.isLoading ? <Skeleton rows={4} /> : q.isError || !q.data ? <ErrorBlock message={errMsg(q.error)} onRetry={() => q.refetch()} /> : (
        <>
          <p role="status" className="text-sm font-bold">{q.data.unreadCount} pesan belum dibaca</p>
          {q.data.items.length === 0 ? <Empty title="Belum ada pemberitahuan" hint="Pesan baru akan tampil di sini secara berkala." /> : (
            <ol className="space-y-3" data-testid="notification-list">
              {q.data.items.map(item => (
                <li key={item.id} data-testid={`notification-${item.id}`} className={`space-y-2 border bg-card p-4 ${item.readAt ? 'border-border' : 'border-primary'}`}>
                  <p className="mono text-xs text-muted-foreground">{fmtDate(item.createdAt)} · {item.readAt ? 'Sudah dibaca' : 'Belum dibaca'}</p>
                  <p className="text-sm font-bold">{item.message}</p>
                  {item.deadline && <p className="text-sm text-amber-100">Batas berlaku: {fmtDate(item.deadline)}</p>}
                  <div className="flex flex-wrap gap-4 text-sm">
                    {item.canOpen && <button disabled={!!busy} onClick={() => void act(item, true)} className="font-bold text-primary underline disabled:opacity-40">Buka kasus</button>}
                    {!item.readAt && <button disabled={!!busy} onClick={() => void act(item, false)} className="font-bold text-primary disabled:opacity-40">{busy === item.id ? 'Memproses…' : 'Tandai dibaca'}</button>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="flex gap-4 text-sm font-bold text-primary">
            {before && <button onClick={() => { const p = [...previous]; setBefore(p.pop() || undefined); setPrevious(p); }}>Pesan lebih baru</button>}
            {q.data.nextCursor && <button onClick={() => { setPrevious([...previous, before ?? '']); setBefore(q.data!.nextCursor!); }}>Pesan lebih lama</button>}
          </div>
        </>
      )}
    </div>
  );
}
