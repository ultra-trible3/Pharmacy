import { create } from 'zustand';

const STORAGE_KEY = 'pharmacy.notifications.read';
/** Keeps the persisted list bounded no matter how long the app is used. */
const MAX_TRACKED = 300;

function readStoredIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function persist(ids: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage failures (private mode / locked profile)
  }
}

interface NotificationsState {
  /** Ids of notifications the user has read. Stable across restarts. */
  readIds: string[];
  markRead: (id: string) => void;
  markManyRead: (ids: string[]) => void;
  /** Drops read flags for notifications that no longer exist. */
  prune: (validIds: string[]) => void;
}

/**
 * Read/unread state for the header notification centre. Notifications are
 * derived from live inventory alerts rather than stored server-side, so the
 * read flags live in localStorage keyed by the notification's stable id.
 */
export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  readIds: readStoredIds(),

  markRead: (id) => {
    const { readIds } = get();
    if (readIds.includes(id)) return;
    const next = [...readIds, id].slice(-MAX_TRACKED);
    persist(next);
    set({ readIds: next });
  },

  markManyRead: (ids) => {
    const current = new Set(get().readIds);
    let changed = false;
    for (const id of ids) {
      if (!current.has(id)) {
        current.add(id);
        changed = true;
      }
    }
    if (!changed) return;
    const next = Array.from(current).slice(-MAX_TRACKED);
    persist(next);
    set({ readIds: next });
  },

  prune: (validIds) => {
    const valid = new Set(validIds);
    const { readIds } = get();
    const next = readIds.filter((id) => valid.has(id));
    if (next.length === readIds.length) return;
    persist(next);
    set({ readIds: next });
  },
}));
