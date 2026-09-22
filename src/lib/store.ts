// Redis-backed data store for chat messages, uploaded media, and typing
// presence. Replaces the previous per-instance in-memory store, which
// caused inconsistent/duplicated/vanishing history whenever requests
// landed on different server instances (or after hot reloads) — each
// instance had its own separate copy of the data. Redis gives every
// instance a single, consistent source of truth.
//
// Data layout in Redis:
//   chat:messages:hash          HASH   id -> JSON.stringify(ChatMessage)
//   chat:messages:index         ZSET   score=createdAt, member=id  (ordering)
//   chat:messages:updatedIndex  ZSET   score=updatedAt, member=id (for sync)
//   media:{id}:buf              STRING raw file bytes, TTL = MEDIA_TTL_MS
//   media:{id}:meta             STRING JSON metadata, TTL = MEDIA_TTL_MS
//   typing:{username}           STRING "1", TTL = TYPING_TTL_MS (presence)

import { redis } from "./redis";

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
export const TYPING_TTL_MS = 4000; // consider "typing" stale after 4s of silence

const MESSAGES_HASH = "chat:messages:hash";
const MESSAGES_INDEX = "chat:messages:index";
const MESSAGES_UPDATED_INDEX = "chat:messages:updatedIndex";
const MAX_MESSAGES = 2000;

function serialize(msg: ChatMessage): string {
  return JSON.stringify(msg);
}

function deserialize(json: string): ChatMessage {
  return JSON.parse(json) as ChatMessage;
}

// NOTE: @upstash/redis is a REST/JSON client. Values passed to `set`/`hset`
// are automatically JSON-serialized/deserialized by the client, so we store
// plain strings (already JSON via our own serialize()) as-is; the client
// will hand them back as strings since they're valid JSON strings. To avoid
// any ambiguity/double-parsing we always serialize to a JSON string
// ourselves and treat whatever comes back as `unknown`, coercing safely.

function coerceToString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val;
  // The client may auto-parse JSON strings back into objects; if so,
  // re-stringify so our deserialize() call below works uniformly.
  return JSON.stringify(val);
}

async function hydrateIds(ids: string[]): Promise<ChatMessage[]> {
  if (ids.length === 0) return [];
  const result = await redis.hmget<Record<string, unknown>>(
    MESSAGES_HASH,
    ...ids
  );
  if (!result) return [];
  const out: ChatMessage[] = [];
  for (const id of ids) {
    const raw = coerceToString(result[id]);
    if (raw) out.push(deserialize(raw));
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addMessage(msg: ChatMessage): Promise<void> {
  await redis.hset(MESSAGES_HASH, { [msg.id]: serialize(msg) });
  await redis.zadd(MESSAGES_INDEX, { score: msg.createdAt, member: msg.id });

  // Keep memory bounded, but generous enough that long conversations
  // don't lose history unexpectedly. Always trims the oldest messages,
  // never the newly added ones.
  const count = await redis.zcard(MESSAGES_INDEX);
  if (count > MAX_MESSAGES) {
    const excess = count - MAX_MESSAGES;
    const staleIds = await redis.zrange<string[]>(MESSAGES_INDEX, 0, excess - 1);
    if (staleIds.length > 0) {
      await Promise.all([
        redis.zrem(MESSAGES_INDEX, ...staleIds),
        redis.zrem(MESSAGES_UPDATED_INDEX, ...staleIds),
        redis.hdel(MESSAGES_HASH, ...staleIds),
      ]);
    }
  }
}

export async function getMessagesSince(
  afterId: string | null,
  updatedSince?: number
): Promise<{ newMessages: ChatMessage[]; updatedMessages: ChatMessage[] }> {
  let newIds: string[];

  if (!afterId) {
    newIds = await redis.zrange<string[]>(MESSAGES_INDEX, 0, -1);
  } else {
    const rank = await redis.zrank(MESSAGES_INDEX, afterId);
    if (rank === null || rank === undefined) {
      // The reference message is gone (trimmed). Returning the full list
      // here is the safest fallback — and now this is consistent across
      // all server instances, since they all read from the same Redis
      // store instead of divergent in-memory copies.
      newIds = await redis.zrange<string[]>(MESSAGES_INDEX, 0, -1);
    } else {
      newIds = await redis.zrange<string[]>(MESSAGES_INDEX, rank + 1, -1);
    }
  }

  const newMessages = await hydrateIds(newIds);

  if (!updatedSince) return { newMessages, updatedMessages: [] };

  // Also include older messages (already delivered) that were updated
  // (e.g. a reaction was added) since the client's last poll, so those
  // updates propagate without re-sending the whole history.
  const updatedIds = await redis.zrange<string[]>(
    MESSAGES_UPDATED_INDEX,
    `(${updatedSince}`,
    "+inf",
    { byScore: true }
  );
  const newIdSet = new Set(newIds);
  const filteredUpdatedIds = updatedIds.filter((id) => !newIdSet.has(id));
  const updatedMessages = await hydrateIds(filteredUpdatedIds);

  return { newMessages, updatedMessages };
}

export async function hasMessage(id: string): Promise<boolean> {
  const exists = await redis.hexists(MESSAGES_HASH, id);
  return exists === 1;
}

export async function getMessageById(id: string): Promise<ChatMessage | undefined> {
  const raw = coerceToString(await redis.hget(MESSAGES_HASH, id));
  return raw ? deserialize(raw) : undefined;
}

/**
 * Toggle a user's reaction on a message. If the user already reacted with
 * the same emoji, it's removed (un-react). If they reacted with a
 * different emoji, it's replaced. Returns the updated message, or
 * undefined if the message doesn't exist.
 */
export async function toggleReaction(
  messageId: string,
  username: string,
  emoji: string
): Promise<ChatMessage | undefined> {
  const raw = coerceToString(await redis.hget(MESSAGES_HASH, messageId));
  if (!raw) return undefined;
  const msg = deserialize(raw);
  const reactions = { ...(msg.reactions || {}) };
  if (reactions[username] === emoji) {
    delete reactions[username];
  } else {
    reactions[username] = emoji;
  }
  msg.reactions = reactions;
  msg.updatedAt = Date.now();

  await redis.hset(MESSAGES_HASH, { [messageId]: serialize(msg) });
  await redis.zadd(MESSAGES_UPDATED_INDEX, {
    score: msg.updatedAt,
    member: messageId,
  });

  return msg;
}

export async function addMedia(entry: MediaEntry): Promise<void> {
  const ttlMs = MEDIA_TTL_MS;
  const meta: Omit<MediaEntry, "buffer"> = {
    id: entry.id,
    contentType: entry.contentType,
    fileName: entry.fileName,
    createdAt: entry.createdAt,
  };
  const base64 = entry.buffer.toString("base64");
  await Promise.all([
    redis.set(`media:${entry.id}:buf`, base64, { px: ttlMs }),
    redis.set(`media:${entry.id}:meta`, JSON.stringify(meta), { px: ttlMs }),
  ]);
}

export async function getMedia(id: string): Promise<MediaEntry | undefined> {
  const [bufRaw, metaRaw] = await Promise.all([
    redis.get<string>(`media:${id}:buf`),
    redis.get<string>(`media:${id}:meta`),
  ]);
  if (!bufRaw || !metaRaw) return undefined;
  const meta = JSON.parse(
    typeof metaRaw === "string" ? metaRaw : JSON.stringify(metaRaw)
  ) as Omit<MediaEntry, "buffer">;
  const buffer = Buffer.from(
    typeof bufRaw === "string" ? bufRaw : String(bufRaw),
    "base64"
  );
  return { ...meta, buffer };
}

export async function setTyping(username: string): Promise<void> {
  await redis.set(`typing:${username}`, "1", { px: TYPING_TTL_MS });
}

export async function clearTyping(username: string): Promise<void> {
  await redis.del(`typing:${username}`);
}

export async function isTyping(username: string): Promise<boolean> {
  const exists = await redis.exists(`typing:${username}`);
  return exists === 1;
}
