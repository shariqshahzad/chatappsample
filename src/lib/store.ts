// In-memory data store for chat messages and uploaded media.
// Everything here lives only in server memory: it resets on server restart
// and media is automatically purged after MEDIA_TTL_MS.
//
// We stash the store on `globalThis` so that Next.js dev-mode hot reloads
// (which re-evaluate modules) don't wipe out existing data or start
// duplicate cleanup timers.

export type ChatMessage = {
  id: string;
  from: string;
  text?: string;
  mediaId?: string;
  mediaType?: string;
  mediaName?: string;
  createdAt: number;
};

export type MediaEntry = {
  id: string;
  buffer: Buffer;
  contentType: string;
  fileName: string;
  createdAt: number;
};

export const MEDIA_TTL_MS = 10 * 60 * 1000; // 10 minutes

type Store = {
  messages: ChatMessage[];
  media: Map<string, MediaEntry>;
  cleanupTimer?: ReturnType<typeof setInterval>;
};

const globalForStore = globalThis as unknown as { __chatStore?: Store };

function createStore(): Store {
  const store: Store = {
    messages: [],
    media: new Map(),
  };

  store.cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of store.media) {
      if (now - entry.createdAt > MEDIA_TTL_MS) {
        store.media.delete(id);
      }
    }
  }, 30 * 1000);

  return store;
}

export const store: Store = globalForStore.__chatStore ?? createStore();
globalForStore.__chatStore = store;

export function addMessage(msg: ChatMessage) {
  store.messages.push(msg);
  // Keep memory bounded.
  if (store.messages.length > 500) {
    store.messages.splice(0, store.messages.length - 500);
  }
}

export function getMessagesSince(afterId: string | null): ChatMessage[] {
  if (!afterId) return store.messages.slice(-100);
  const idx = store.messages.findIndex((m) => m.id === afterId);
  if (idx === -1) return store.messages.slice(-100);
  return store.messages.slice(idx + 1);
}

export function addMedia(entry: MediaEntry) {
  store.media.set(entry.id, entry);
}

export function getMedia(id: string): MediaEntry | undefined {
  const entry = store.media.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > MEDIA_TTL_MS) {
    store.media.delete(id);
    return undefined;
  }
  return entry;
}
