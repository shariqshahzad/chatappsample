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
  updatedAt?: number;
  replyToId?: string;
  // Snapshot of the replied-to message content, so it still renders even
  // if the original later gets trimmed from history.
  replyPreview?: {
    from: string;
    text?: string;
    mediaType?: string;
    mediaName?: string;
  };
  // Map of username -> emoji, one reaction per user per message.
  reactions?: Record<string, string>;
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
  typing: Map<string, number>; // username -> timestamp of last typing signal
  cleanupTimer?: ReturnType<typeof setInterval>;
};

const globalForStore = globalThis as unknown as { __chatStore?: Store };

function createStore(): Store {
  const store: Store = {
    messages: [],
    media: new Map(),
    typing: new Map(),
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
  // Keep memory bounded, but generous enough that long conversations
  // don't lose history unexpectedly. Always trims from the front (oldest
  // messages), never the newly added ones.
  if (store.messages.length > 2000) {
    store.messages.splice(0, store.messages.length - 2000);
  }
}

export function getMessagesSince(
  afterId: string | null,
  updatedSince?: number
): { newMessages: ChatMessage[]; updatedMessages: ChatMessage[] } {
  let newMessages: ChatMessage[];
  if (!afterId) {
    newMessages = store.messages;
  } else {
    const idx = store.messages.findIndex((m) => m.id === afterId);
    if (idx === -1) {
      // The reference message is gone (trimmed, or this request landed on a
      // different in-memory instance). Returning the full list here would
      // make already-seen messages reappear duplicated, or make the client
      // think older messages "vanished" if this instance's history differs.
      // Signal the caller to do a full resync instead of guessing.
      newMessages = store.messages;
    } else {
      newMessages = store.messages.slice(idx + 1);
    }
  }

  if (!updatedSince) return { newMessages, updatedMessages: [] };

  // Also include older messages (already delivered) that were updated
  // (e.g. a reaction was added) since the client's last poll, so those
  // updates propagate without re-sending the whole history.
  const newIds = new Set(newMessages.map((m) => m.id));
  const updatedMessages = store.messages.filter(
    (m) => !newIds.has(m.id) && (m.updatedAt || 0) > updatedSince
  );
  return { newMessages, updatedMessages };
}

export function hasMessage(id: string): boolean {
  return store.messages.some((m) => m.id === id);
}

export function getMessageById(id: string): ChatMessage | undefined {
  return store.messages.find((m) => m.id === id);
}

/**
 * Toggle a user's reaction on a message. If the user already reacted with
 * the same emoji, it's removed (un-react). If they reacted with a
 * different emoji, it's replaced. Returns the updated message, or
 * undefined if the message doesn't exist.
 */
export function toggleReaction(
  messageId: string,
  username: string,
  emoji: string
): ChatMessage | undefined {
  const msg = store.messages.find((m) => m.id === messageId);
  if (!msg) return undefined;
  const reactions = { ...(msg.reactions || {}) };
  if (reactions[username] === emoji) {
    delete reactions[username];
  } else {
    reactions[username] = emoji;
  }
  msg.reactions = reactions;
  msg.updatedAt = Date.now();
  return msg;
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

export const TYPING_TTL_MS = 4000; // consider "typing" stale after 4s of silence

export function setTyping(username: string) {
  store.typing.set(username, Date.now());
}

export function clearTyping(username: string) {
  store.typing.delete(username);
}

export function isTyping(username: string): boolean {
  const ts = store.typing.get(username);
  if (!ts) return false;
  if (Date.now() - ts > TYPING_TTL_MS) {
    store.typing.delete(username);
    return false;
  }
  return true;
}
