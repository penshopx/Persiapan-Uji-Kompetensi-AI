import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetUjkPassport, useGetUjkJourney, useGetUjkHistory,
  getGetUjkPassportQueryKey, getGetUjkJourneyQueryKey, getGetUjkHistoryQueryKey,
  type UjkHistoryEvent,
} from '@workspace/api-client-react';

export const FIRST_CURSOR = 2147483647;
const FRESH = 30_000;

export function useSignedIn() {
  const { isSignedIn, userId } = useAuth();
  return { signedIn: !!isSignedIn, userId };
}

export function usePassport() {
  const { signedIn } = useSignedIn();
  return useGetUjkPassport({ query: { enabled: signedIn, queryKey: getGetUjkPassportQueryKey(), staleTime: FRESH } });
}

export function useJourney(id: string) {
  const { signedIn } = useSignedIn();
  return useGetUjkJourney(id, { query: { enabled: signedIn && !!id, queryKey: getGetUjkJourneyQueryKey(id), staleTime: FRESH } });
}

/** Refreshes passport, journey and every history page for a journey. */
export function useInvalidateJourney() {
  const qc = useQueryClient();
  return useCallback((id: string) => {
    qc.invalidateQueries({ queryKey: getGetUjkPassportQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUjkJourneyQueryKey(id) });
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(`/api/ujk/journeys/${id}/history/`) });
  }, [qc]);
}

export function usePagedHistory(id: string) {
  const { signedIn } = useSignedIn();
  const [cursor, setCursor] = useState(FIRST_CURSOR);
  const [events, setEvents] = useState<UjkHistoryEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const deep = useRef(false);
  const q = useGetUjkHistory(id, cursor, { query: { enabled: signedIn && !!id, queryKey: getGetUjkHistoryQueryKey(id, cursor), staleTime: FRESH } });
  const data = q.data;
  useEffect(() => {
    if (!data) return;
    setEvents((prev) => {
      const m = new Map<number, UjkHistoryEvent>();
      for (const e of prev) m.set(e.id, e);
      for (const e of data.events) m.set(e.id, e);
      return [...m.values()].sort((a, b) => b.id - a.id);
    });
    if (cursor !== FIRST_CURSOR || !deep.current) setNext(data.nextCursor);
  }, [data, cursor]);
  const loadMore = () => { if (next != null) { deep.current = true; setCursor(next); } };
  const reset = () => { deep.current = false; setCursor(FIRST_CURSOR); };
  return { reset, events, hasMore: next != null, loadMore, loadingMore: q.isFetching && cursor !== FIRST_CURSOR, isLoading: q.isLoading, isError: q.isError, error: q.error, retry: () => q.refetch() };
}
