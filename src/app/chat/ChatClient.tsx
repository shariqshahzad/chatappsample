"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage } from "@/lib/store";

type Props = {
  currentUser: string;
  peerUser: string;
};

const POLL_INTERVAL_MS = 2000;
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isImage(type?: string) {
  return !!type && type.startsWith("image/");
}

function isAudio(type?: string) {
  return !!type && type.startsWith("audio/");
}

function formatDuration(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function VoicePlayer({ src, mine }: { src: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  }

  const barColor = mine ? "bg-white/40" : "bg-slate-300 dark:bg-slate-600";
  const fillColor = mine ? "bg-white" : "bg-blue-500";
  const btnColor = mine
    ? "bg-white/20 hover:bg-white/30 text-white"
    : "bg-blue-100 hover:bg-blue-200 text-blue-600 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-blue-400";
  const timeColor = mine ? "text-blue-100" : "text-slate-400";

  return (
    <div className="mt-1 flex w-full min-w-[220px] max-w-[320px] items-center gap-2 sm:max-w-[380px]">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={togglePlay}
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-base transition ${btnColor}`}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          onClick={seek}
          className={`h-1.5 w-full cursor-pointer rounded-full ${barColor}`}
        >
          <div
            className={`h-1.5 rounded-full ${fillColor}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className={`text-[10px] tabular-nums ${timeColor}`}>
          {formatDuration(playing || currentTime > 0 ? currentTime : duration)}
        </span>
      </div>
    </div>
  );
}

export default function ChatClient({ currentUser, peerUser }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [openReactionFor, setOpenReactionFor] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);

  const lastIdRef = useRef<string | null>(null);
  const updatedSinceRef = useRef<number>(0);
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
      const params = new URLSearchParams();
      if (lastIdRef.current) params.set("after", lastIdRef.current);
      if (updatedSinceRef.current) {
        params.set("updatedSince", String(updatedSinceRef.current));
      }
      const qs = params.toString();
      const url = qs ? `/api/messages?${qs}` : "/api/messages";
      const res = await fetch(url);
      if (res.status === 401) {
        router.push("/");
        return;
      }
      const data = await res.json();
      const incoming: ChatMessage[] = data.messages ?? [];
      const updated: ChatMessage[] = data.updatedMessages ?? [];
      if (incoming.length > 0 || updated.length > 0) {
        setMessages((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]));
          for (const msg of [...updated, ...incoming]) {
            byId.set(msg.id, msg);
          }
          // Preserve chronological order.
          return Array.from(byId.values()).sort(
            (a, b) => a.createdAt - b.createdAt
          );
        });
      }
      if (incoming.length > 0) {
        const newestIncoming = incoming.reduce((max, m) =>
          m.createdAt > max.createdAt ? m : max
        );
        lastIdRef.current = newestIncoming.id;
      }
      if (typeof data.serverTime === "number") {
        updatedSinceRef.current = data.serverTime;
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

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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
        body: JSON.stringify({
          text: trimmed,
          replyToId: replyTarget?.id,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to send message");
        return;
      }
      setText("");
      setReplyTarget(null);
      await poll();
    } finally {
      setSending(false);
    }
  }

  async function handleReact(messageId: string, emoji: string) {
    setOpenReactionFor(null);
    try {
      const res = await fetch("/api/messages/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, emoji }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setMessages((prev) =>
            prev.map((m) => (m.id === data.message.id ? data.message : m))
          );
        }
      }
      await poll();
    } catch {
      // Ignore; next poll will resync reaction state.
    }
  }

  async function uploadFile(file: File | Blob, fileName: string) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file, fileName);
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
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadFile(file, file.name);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function pickRecordingMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (const type of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "";
  }

  async function startRecording() {
    setRecordError(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecordError("Voice recording is not supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        recordedChunksRef.current = [];
        if (blob.size > 0) {
          const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
          await uploadFile(blob, `voice-note-${Date.now()}.${ext}`);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setRecordError("Microphone permission denied or unavailable");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
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
          const reactions = m.reactions || {};
          const reactionEntries = Object.entries(reactions);
          const myReaction = reactions[currentUser];
          return (
            <div
              key={m.id}
              className={`group flex items-center gap-1 ${
                mine ? "justify-end" : "justify-start"
              }`}
            >
              {mine && (
                <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setOpenReactionFor(openReactionFor === m.id ? null : m.id)}
                    title="React"
                    className="rounded-full p-1.5 text-sm text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    😊
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplyTarget(m)}
                    title="Reply"
                    className="rounded-full p-1.5 text-sm text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    ↩️
                  </button>
                </div>
              )}
              <div className="relative max-w-[80%] sm:max-w-[60%]">
                {openReactionFor === m.id && (
                  <div
                    className={`absolute -top-10 z-10 flex gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800 ${
                      mine ? "right-0" : "left-0"
                    }`}
                  >
                    {REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleReact(m.id, emoji)}
                        className={`rounded-full px-1 text-lg transition hover:scale-125 ${
                          myReaction === emoji ? "bg-blue-100 dark:bg-slate-600" : ""
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                <div
                  className={`rounded-2xl px-4 py-2 shadow ${
                    mine
                      ? "rounded-br-sm bg-blue-600 text-white"
                      : "rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                  }`}
                >
                  {m.replyPreview && (
                    <div
                      className={`mb-1.5 rounded-lg border-l-4 px-2 py-1 text-xs ${
                        mine
                          ? "border-blue-300 bg-blue-700/50 text-blue-100"
                          : "border-blue-400 bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <p className="font-semibold">
                        {m.replyPreview.from === currentUser ? "You" : m.replyPreview.from}
                      </p>
                      <p className="truncate">
                        {m.replyPreview.text ||
                          (m.replyPreview.mediaType?.startsWith("audio/")
                            ? "🎤 Voice note"
                            : m.replyPreview.mediaType?.startsWith("image/")
                            ? "📷 Photo"
                            : `📎 ${m.replyPreview.mediaName || "Attachment"}`)}
                      </p>
                    </div>
                  )}
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
                    ) : isAudio(m.mediaType) ? (
                      <VoicePlayer src={`/api/media/${m.mediaId}`} mine={mine} />
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
                {reactionEntries.length > 0 && (
                  <div
                    className={`absolute -bottom-3 flex gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-xs shadow dark:border-slate-700 dark:bg-slate-800 ${
                      mine ? "right-2" : "left-2"
                    }`}
                  >
                    {reactionEntries.map(([user, emoji]) => (
                      <span key={user} title={user}>
                        {emoji}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {!mine && (
                <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setReplyTarget(m)}
                    title="Reply"
                    className="rounded-full p-1.5 text-sm text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    ↩️
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenReactionFor(openReactionFor === m.id ? null : m.id)}
                    title="React"
                    className="rounded-full p-1.5 text-sm text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    😊
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </main>

      {error && (
        <p className="px-4 pb-1 text-center text-xs text-red-500">{error}</p>
      )}
      {recordError && (
        <p className="px-4 pb-1 text-center text-xs text-red-500">{recordError}</p>
      )}

      {replyTarget && (
        <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="min-w-0 flex-1 border-l-4 border-blue-500 pl-2">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              Replying to {replyTarget.from === currentUser ? "yourself" : replyTarget.from}
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {replyTarget.text ||
                (isAudio(replyTarget.mediaType)
                  ? "🎤 Voice note"
                  : isImage(replyTarget.mediaType)
                  ? "📷 Photo"
                  : `📎 ${replyTarget.mediaName || "Attachment"}`)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReplyTarget(null)}
            className="flex-shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            title="Cancel reply"
          >
            ✕
          </button>
        </div>
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
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xl transition ${
            recording
              ? "animate-pulse bg-red-500 text-white hover:bg-red-600"
              : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
          }`}
          title={recording ? "Stop recording" : "Record voice note"}
        >
          {recording ? "⏹️" : "🎤"}
        </button>
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
