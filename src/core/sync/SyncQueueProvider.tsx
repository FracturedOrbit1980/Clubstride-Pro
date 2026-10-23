import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { SyncQueue, type SyncQueueSnapshot } from './syncQueue';

type SyncQueueContextValue = SyncQueueSnapshot & { queue: SyncQueue };

const SyncQueueContext = createContext<SyncQueueContextValue | null>(null);

/**
 * Owns one queue for the signed-in account. Mount it inside AuthProvider: the queue is keyed by
 * user id because the migration pins `created_by = auth.uid()`, so it cannot exist before the
 * session is known.
 */
export const SyncQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const queue = useMemo(() => new SyncQueue(supabase), []);

  useEffect(() => {
    queue.attach(user?.id ?? null);
  }, [queue, user?.id]);

  useEffect(() => () => queue.dispose(), [queue]);

  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const value = useMemo<SyncQueueContextValue>(() => ({ ...snapshot, queue }), [snapshot, queue]);

  return <SyncQueueContext.Provider value={value}>{children}</SyncQueueContext.Provider>;
};

export const useSyncQueue = (): SyncQueueContextValue => {
  const context = useContext(SyncQueueContext);
  if (!context) throw new Error('useSyncQueue must be used within a SyncQueueProvider');
  return context;
};
