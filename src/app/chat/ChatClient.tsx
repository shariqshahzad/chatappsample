"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage } from "@/lib/store";

type Props = {
  currentUser: string;
  peerUser: string;
};

const POLL_INTERVAL_MS = 2000;

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isImage(type?: string) {
  return !!type && type.startsWith("image/");
}

export default function ChatClient({ currentUser, peerUser }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastIdRef = useRef<string | null>(null);
  const pollingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const poll = useCallback(async () => {
    if (pollingRef.current) return; // avoid overlapping requests causing dupes
    pollingRef.current = true;
    try {
      const url = lastIdRef.current
        ? `/api/messages?after=${lastIdRef.current}`
        : "/api/messages";
      const res = await fetch(url);
      if (res.status === 401) {
        router.push("/");
        return;
      }
      const data = await res.json();
      const incoming: ChatMessage[] = data.messages ?? [];
      if (incoming.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const deduped = incoming.filter((m) => !seen.has(m.id));
          if (deduped.length === 0) return prev;
          return lastIdRef.current ? [...prev, ...deduped] : deduped;
        });
        lastIdRef.current = incoming[incoming.length - 1].id;
      }
    } catch {
      // Ignore transient network errors; next poll will retry.
    } finally {
      pollingRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to send message");
        return;
      }
      setText("");
      await poll();
    } finally {
      setSending(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to upload file");
        return;
      }
      await poll();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-100 dark:bg-slate-950">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Chatting with
          </p>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {peerUser}
          </h1>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Logout
        </button>
      </header>

      {/* Messages */}
      <main className="flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-6">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-slate-400">
            No messages yet. Say hello 👋
          </p>
        )}
        {messages.map((m) => {
          const mine = m.from === currentUser;
          return (
            <div
              key={m.id}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 shadow sm:max-w-[60%] ${
                  mine
                    ? "rounded-br-sm bg-blue-600 text-white"
                    : "rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                }`}
              >
                {m.text && (
                  <p className="whitespace-pre-wrap break-words text-[15px]">
                    {m.text}
                  </p>
                )}
                {m.mediaId &&
                  (isImage(m.mediaType) ? (
                    <a
                      href={`/api/media/${m.mediaId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/media/${m.mediaId}`}
                        alt={m.mediaName || "shared image"}
                        className="mt-1 max-h-72 w-full rounded-lg object-cover"
                      />
                    </a>
                  ) : (
                    <a
                      href={`/api/media/${m.mediaId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm underline ${
                        mine ? "bg-blue-700" : "bg-slate-100 dark:bg-slate-700"
                      }`}
                    >
                      📎 {m.mediaName || "Download file"}
                    </a>
                  ))}
                <p
                  className={`mt-1 text-right text-[10px] ${
                    mine ? "text-blue-100" : "text-slate-400"
                  }`}
                >
                  {formatTime(m.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </main>

      {error && (
        <p className="px-4 pb-1 text-center text-xs text-red-500">{error}</p>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.txt,.doc,.docx"
          onChange={handleFileChange}
          className="hidden"
          id="media-upload"
        />
        <label
          htmlFor="media-upload"
          className="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-xl hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
          title="Upload media (kept for 10 minutes)"
        >
          {uploading ? "⏳" : "📎"}
        </label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="min-w-0 flex-1 rounded-full border border-slate-300 px-4 py-2 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-50"
          title="Send"
        >
          ➤
        </button>
      </form>
      <p className="bg-white px-3 pb-2 text-center text-[11px] text-slate-400 dark:bg-slate-900">
        Uploaded media is stored in server memory and auto-deletes after 10
        minutes.
      </p>
    </div>
  );
}
