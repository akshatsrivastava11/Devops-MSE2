"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { loadName, saveName } from "@/lib/handle";
import {
  ClientToServer, Kind, LANGS, Lang, MAX_BODY_BYTES, MAX_NAME, Message, Person, ROOM_ID, RoomMeta,
  ServerToClient, WipeReason, byteLength,
} from "@/lib/protocol";
import { Wordmark } from "./Wordmark";
import { Entry } from "./Entry";

type Sock = Socket<ServerToClient, ClientToServer>;
type Tab = "feed" | "pad" | "room";
type Status =
  | { s: "connecting" }
  | { s: "ready" }
  | { s: "gone" }
  | { s: "wiped"; reason: WipeReason; by?: string }
  | { s: "error" };

const ERRORS: Record<string, string> = {
  "slow-down": "Slow down a little; posting again in a second.",
  "too-large": `That is over ${MAX_BODY_BYTES / 1024} KB. Trim it or split it.`,
  "room-full": "This room holds 500 entries and is full.",
  empty: "There is nothing to post.",
};

function readTab(): Tab {
  if (typeof window === "undefined") return "feed";
  const t = new URLSearchParams(window.location.search).get("tab");
  return t === "pad" || t === "room" ? t : "feed";
}

export function Room({ roomId }: { roomId: string }) {
  const valid = ROOM_ID.test(roomId);
  const sock = useRef<Sock | null>(null);
  const [status, setStatus] = useState<Status>(valid ? { s: "connecting" } : { s: "gone" });
  const [online, setOnline] = useState(true);
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [skew, setSkew] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [you, setYou] = useState("");
  const [name, setName] = useState("");
  const [pad, setPad] = useState({ text: "", by: "" });
  const [tab, setTabState] = useState<Tab>("feed");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const say = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    if (t === "feed") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => setTabState(readTab()), []);

  useEffect(() => {
    if (!valid) return;
    const myName = loadName();
    setName(myName);
    const s: Sock = io({ transports: ["websocket", "polling"] });
    sock.current = s;
    let ended = false;

    const join = () =>
      s.emit("join", { roomId, name: loadName() }, (r) => {
        if (!r.ok) {
          ended = true;
          setStatus(r.error === "not-found" ? { s: "gone" } : { s: "error" });
          s.disconnect();
          return;
        }
        setRoom(r.room);
        setSkew(r.now - Date.now());
        setMessages(r.messages);
        setPeople(r.people);
        setPad((p) => (p.text === r.pad ? p : { text: r.pad, by: "" }));
        setYou(r.you);
        setOnline(true);
        setStatus({ s: "ready" });
      });

    s.on("connect", join);
    s.on("disconnect", () => { if (!ended) setOnline(false); });
    s.on("connect_error", () => setOnline(false));
    s.on("message", (m) => setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m])));
    s.on("people", setPeople);
    s.on("pad", setPad);
    s.on("wiped", (w) => {
      ended = true;
      setMessages([]);
      setPad({ text: "", by: "" });
      setStatus({ s: "wiped", reason: w.reason, by: w.by });
    });

    return () => {
      ended = true;
      s.removeAllListeners();
      s.disconnect();
      sock.current = null;
    };
  }, [roomId, valid]);

  if (status.s === "gone") return <Gone />;
  if (status.s === "wiped") return <Wiped reason={status.reason} by={status.by} />;
  if (status.s === "error") return <Broken />;

  const ready = status.s === "ready" && room;
  const send: Sender = (event, payload) =>
    new Promise((resolve) => {
      const s = sock.current;
      if (!s?.connected) return resolve({ ok: false, error: "offline" });
      if (event === "burn") s.emit("burn", resolve);
      else if (event === "rename") s.emit("rename", payload as { name: string }, resolve);
      else s.emit("post", payload as Parameters<ClientToServer["post"]>[0], resolve);
    });

  const aside = ready ? (
    <RoomDetails
      people={people} you={you} name={name} room={room}
      onRename={async (n) => {
        const r = await send("rename", { name: n });
        if (r.ok) { saveName(n); setName(n); say("Name changed"); }
        return r.ok;
      }}
      onBurn={() => send("burn")}
    />
  ) : null;

  return (
    <div className="room">
      <header className="bar">
        <Wordmark />
        <div className="room__code">
          <span className="mono" aria-label={`Room code ${roomId.split("").join(" ")}`}>{roomId}</span>
          <button
            type="button" className="btn btn--quiet"
            onClick={() => navigator.clipboard.writeText(window.location.origin + `/r/${roomId}`).then(() => say("Link copied"), () => say("Copy failed"))}
          >
            Copy link
          </button>
        </div>
        <div className="bar__spacer" />
        {ready && (
          <>
            <ul className="present" aria-label="In this room">
              {people.slice(0, 5).map((p) => (
                <li key={p.id} className="chip chip--person">{p.id === you ? `${p.name} (you)` : p.name}</li>
              ))}
              {people.length > 5 && <li className="chip">{people.length - 5} more</li>}
            </ul>
            <Clock expiresAt={room.expiresAt} skew={skew} />
          </>
        )}
      </header>

      <div className="room__body">
        <main className="room__main" data-tab={tab}>
          <div>
            {!online && status.s === "ready" && <p className="banner" role="status">Connection lost. Reconnecting; nothing you type is lost.</p>}
            <div className="tabs" role="tablist" aria-label="Room views">
              <TabButton id="feed" tab={tab} setTab={setTab}>Feed <span className="tab__count">{messages.length}</span></TabButton>
              <TabButton id="pad" tab={tab} setTab={setTab}>Scratchpad</TabButton>
              <TabButton id="room" tab={tab} setTab={setTab} narrow>People <span className="tab__count">{people.length}</span></TabButton>
            </div>
          </div>

          {tab === "feed" && (
            <Feed messages={messages} loading={!ready} say={say} />
          )}
          {tab === "pad" && (
            <Pad
              text={pad.text} by={pad.by} disabled={!ready || !online}
              onChange={(text) => { setPad({ text, by: "" }); sock.current?.emit("pad", { text }); }}
            />
          )}
          {tab === "room" && <div id="panel-room" role="tabpanel" className="room__aside-slot">{aside}</div>}

          {tab === "feed" && (
            <Composer disabled={!ready} onPost={async (p) => {
              const r = await send("post", p);
              if (!r.ok) say(ERRORS[r.error] ?? (r.error === "offline" ? "Offline. Wait for the connection to return." : "That did not post. Try again."));
              return r.ok;
            }} />
          )}
          {tab === "pad" && <div />}
          {tab === "room" && <div />}
        </main>
        <aside className="room__aside" aria-label="Room details">{aside}</aside>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

type Sender = (event: "post" | "rename" | "burn", payload?: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;

function TabButton({ id, tab, setTab, narrow, children }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; narrow?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`}
      className={narrow ? "tab tab--narrow" : "tab"} onClick={() => setTab(id)}
    >
      {children}
    </button>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function fmtClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Clock({ expiresAt, skew }: { expiresAt: number; skew: number }) {
  const now = useNow(1000);
  const left = expiresAt - (now + skew);
  const mins = Math.ceil(left / 60000);
  return (
    <div className="clock" data-low={left < 5 * 60_000}>
      <span className="clock__value" role="timer" aria-label={`${mins} minutes until this room is wiped`}>{fmtClock(left)}</span>
      <span className="clock__label">until wipe</span>
    </div>
  );
}

function Feed({ messages, loading, say }: { messages: Message[]; loading: boolean; say: (s: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the newest entry while the reader is at the bottom, including when
  // fonts or highlighting change an entry's height after it lands.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const follow = () => { if (stick.current) el.scrollTop = el.scrollHeight; };
    follow();
    const ro = new ResizeObserver(follow);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [messages.length, loading]);

  return (
    <div
      id="panel-feed" role="tabpanel" aria-labelledby="tab-feed" className="feed" ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {loading ? (
        <>
          <div className="skeleton" aria-hidden="true" />
          <div className="skeleton" aria-hidden="true" />
          <p className="visually-hidden" role="status">Joining the room</p>
        </>
      ) : messages.length === 0 ? (
        <div className="empty">
          <h2>Nothing here yet</h2>
          <p>Paste a stack trace, a failing query or a hunch below. Send the link to whoever is helping.</p>
        </div>
      ) : (
        <div role="log" aria-live="polite" aria-relevant="additions" style={{ display: "grid", gap: "var(--space-md)" }}>
          {messages.map((m) => <Entry key={m.id} m={m} say={say} />)}
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<Kind, string> = { snippet: "Snippet", log: "Log", note: "Note" };
const PLACEHOLDER: Record<Kind, string> = {
  snippet: "Paste code",
  log: "Paste log output; error lines are marked",
  note: "What you have tried, what you suspect",
};

function Composer({ disabled, onPost }: { disabled: boolean; onPost: (p: { kind: Kind; lang?: Lang; title?: string; body: string }) => Promise<boolean> }) {
  const [kind, setKind] = useState<Kind>("snippet");
  const [lang, setLang] = useState<Lang>("auto");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const bytes = useMemo(() => byteLength(body), [body]);
  const over = bytes > MAX_BODY_BYTES;
  const area = useRef<HTMLTextAreaElement>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || disabled || !body.trim() || over) return;
    setBusy(true);
    const ok = await onPost({ kind, lang: kind === "snippet" ? lang : undefined, title: title || undefined, body });
    setBusy(false);
    if (ok) { setBody(""); setTitle(""); area.current?.focus(); }
  }

  return (
    <form className="composer" data-kind={kind} onSubmit={submit} aria-label="Post to the room">
      <div className="composer__row">
        <div className="segmented" role="radiogroup" aria-label="Kind of entry">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        {kind === "snippet" && (
          <select className="select" aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)} name="lang">
            {LANGS.map((l) => <option key={l} value={l}>{l === "auto" ? "Detect language" : l}</option>)}
          </select>
        )}
        <input
          className="input" name="title" placeholder="Title, optional" aria-label="Title" maxLength={80}
          autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <textarea
        ref={area} className="textarea" name="body" aria-label={KIND_LABEL[kind]} placeholder={PLACEHOLDER[kind]}
        spellCheck={kind === "note"} value={body} disabled={disabled}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
      />
      <div className="composer__foot">
        <p className="composer__meta" data-tone={over ? "bad" : undefined} style={over ? { color: "var(--color-bad)" } : undefined}>
          {bytes > MAX_BODY_BYTES / 2
            ? <span className="mono">{(bytes / 1024).toFixed(1)} / {MAX_BODY_BYTES / 1024} KB</span>
            : <>Post with <kbd>Ctrl</kbd> + <kbd>Enter</kbd></>}
        </p>
        <button type="submit" className="btn btn--primary" disabled={disabled || busy || !body.trim() || over} data-busy={busy}>
          {busy ? "Posting" : "Post"}
        </button>
      </div>
    </form>
  );
}

function Pad({ text, by, disabled, onChange }: { text: string; by: string; disabled: boolean; onChange: (t: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const sel = useRef<[number, number] | null>(null);

  // A remote edit replaces the text; keep the local caret where it was.
  useEffect(() => {
    const el = ref.current;
    if (el && sel.current && document.activeElement === el) el.setSelectionRange(sel.current[0], sel.current[1]);
  }, [text]);

  return (
    <div id="panel-pad" role="tabpanel" aria-labelledby="tab-pad" className="pad">
      <div className="pad__head">
        <span>Everyone edits the same text, live.</span>
        {by && <span>Last edit by <span className="person">{by}</span></span>}
      </div>
      <textarea
        ref={ref} className="textarea" aria-label="Shared scratchpad" spellCheck={false} disabled={disabled}
        placeholder="A shared buffer for the repro you are building together" value={text}
        onSelect={(e) => { sel.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd]; }}
        onChange={(e) => { sel.current = [e.target.selectionStart, e.target.selectionEnd]; onChange(e.target.value); }}
      />
    </div>
  );
}

function RoomDetails({ people, you, name, room, onRename, onBurn }: {
  people: Person[]; you: string; name: string; room: RoomMeta;
  onRename: (n: string) => Promise<boolean>; onBurn: () => Promise<{ ok: boolean }>;
}) {
  const [draft, setDraft] = useState(name);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => setDraft(name), [name]);
  const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const opened = hm(room.createdAt);
  const closes = hm(room.expiresAt);

  return (
    <>
      <section className="aside-section">
        <h2>In this room</h2>
        <ul className="people">
          {people.map((p) => (
            <li key={p.id}>
              <span className="person">{p.name}</span>
              {p.id === you && <span className="chip">you</span>}
            </li>
          ))}
        </ul>
        <form
          className="rename"
          onSubmit={async (e) => { e.preventDefault(); const n = draft.trim(); if (n && n !== name) await onRename(n); }}
        >
          <input
            className="input" name="name" aria-label="Your name" maxLength={MAX_NAME} autoComplete="nickname"
            value={draft} onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!draft.trim() || draft.trim() === name}>Rename</button>
        </form>
      </section>

      <section className="aside-section">
        <h2>This room is wiped when</h2>
        <ol className="rules">
          <li>the clock runs out at <span className="mono">{closes}</span> (opened <span className="mono">{opened}</span>)</li>
          <li>everyone has been gone for <span className="mono">15</span> seconds</li>
          <li>anyone presses burn</li>
        </ol>
      </section>

      <section className="aside-section">
        <button type="button" className="btn btn--danger" onClick={() => dialog.current?.showModal()}>Burn this room now</button>
        <dialog ref={dialog} className="confirm" aria-labelledby="burn-title">
          <h2 id="burn-title">Burn this room for everyone?</h2>
          <p>Every entry and the scratchpad are deleted from the server, and everyone here is sent out. This cannot be undone.</p>
          <form method="dialog" className="state__actions">
            <button type="submit" className="btn" autoFocus>Keep it</button>
            <button type="button" className="btn btn--danger" onClick={async () => { dialog.current?.close(); await onBurn(); }}>Burn it</button>
          </form>
        </dialog>
      </section>
    </>
  );
}

function Gone() {
  return (
    <main className="state">
      <h1>This room is gone, or never was.</h1>
      <p>Rooms are wiped after an hour, or once everyone leaves. Nothing from it can be recovered.</p>
      <div className="state__actions"><Link className="btn btn--primary" href="/">Open a new room</Link></div>
    </main>
  );
}

const WIPE_COPY: Record<WipeReason, string> = {
  expired: "The hour ran out.",
  empty: "Everyone left.",
  burned: "Someone burned it.",
};

function Wiped({ reason, by }: { reason: WipeReason; by?: string }) {
  return (
    <main className="state">
      <h1>{reason === "burned" && by ? `${by} burned this room.` : WIPE_COPY[reason]}</h1>
      <p>Every entry and the scratchpad have been deleted from the server. Nothing from it can be recovered.</p>
      <div className="state__actions"><Link className="btn btn--primary" href="/">Open a new room</Link></div>
    </main>
  );
}

function Broken() {
  return (
    <main className="state">
      <h1>Could not join this room.</h1>
      <p>The server refused the connection. Reload to try again.</p>
      <div className="state__actions">
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>Reload</button>
        <Link className="btn" href="/">Go to the start</Link>
      </div>
    </main>
  );
}
