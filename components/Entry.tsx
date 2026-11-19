"use client";

import { memo, useMemo, useState } from "react";
import { highlightLines, plainLines } from "@/lib/highlight";
import type { Message } from "@/lib/protocol";

const BAD = /\b(error|err|fatal|panic|exception|failed|failure|traceback|critical)\b/i;
const QUIET = /\b(debug|trace|verbose)\b/i;
const COLLAPSE_AT = 18;

function rowClass(m: Message, raw: string, lang: string) {
  if (m.kind === "log") return BAD.test(raw) ? "is-bad" : QUIET.test(raw) ? "is-quiet" : undefined;
  if (lang === "diff") return raw.startsWith("+") && !raw.startsWith("+++") ? "is-add" : raw.startsWith("-") && !raw.startsWith("---") ? "is-del" : undefined;
  return undefined;
}

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export const Entry = memo(function Entry({ m, say }: { m: Message; say: (s: string) => void }) {
  const isCode = m.kind !== "note";
  const { lines, lang } = useMemo(
    () => (m.kind === "snippet" ? highlightLines(m.body, m.lang) : { lines: m.kind === "log" ? plainLines(m.body) : [], lang: "log" }),
    [m],
  );
  const raw = useMemo(() => m.body.split("\n"), [m.body]);
  const long = isCode && lines.length > COLLAPSE_AT;
  const [open, setOpen] = useState(false);
  const errors = m.kind === "log" ? raw.filter((l) => BAD.test(l)).length : 0;

  return (
    <article className="entrylog" data-collapsed={long && !open} aria-label={`${m.kind} from ${m.author}`}>
      <header className="entrylog__head">
        <span className="entrylog__author person">{m.author}</span>
        <span className="chip">{m.kind === "snippet" ? (lang === "plaintext" ? "text" : lang) : m.kind}</span>
        {errors > 0 && <span className="chip" style={{ color: "var(--color-bad)", borderColor: "var(--color-bad)" }}>{errors} error {errors === 1 ? "line" : "lines"}</span>}
        {m.title && <span className="entrylog__title">{m.title}</span>}
        <time className="entrylog__time" dateTime={new Date(m.at).toISOString()}>{time(m.at)}</time>
        <div className="entrylog__tools">
          <button
            type="button" className="btn btn--quiet"
            onClick={() => navigator.clipboard.writeText(m.body).then(() => say("Copied"), () => say("Copy failed"))}
          >
            Copy
          </button>
        </div>
      </header>
      {isCode ? (
        <>
          <pre className="code" tabIndex={0} aria-label={m.title ?? `${m.kind} body`}>
            <table>
              <tbody>
                {lines.map((html, i) => (
                  <tr key={i} className={rowClass(m, raw[i] ?? "", lang)}>
                    <td className="ln">{i + 1}</td>
                    <td className="src" dangerouslySetInnerHTML={{ __html: html || " " }} />
                  </tr>
                ))}
              </tbody>
            </table>
          </pre>
          {long && (
            <button type="button" className="more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Show less" : `Show all ${lines.length} lines`}
            </button>
          )}
        </>
      ) : (
        <p className="entrylog__note">{m.body}</p>
      )}
    </article>
  );
});
