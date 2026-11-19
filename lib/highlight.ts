import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { Lang } from "./protocol";

const langs = { bash, c, cpp, csharp, css, diff, go, java, javascript, json, php, plaintext, python, ruby, rust, sql, typescript, xml, yaml };
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def);

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Returns one HTML string per source line, with spans closed and reopened at
// line breaks so each line can sit in its own table row next to its number.
export function highlightLines(code: string, lang: Lang | undefined): { lines: string[]; lang: string } {
  let html: string;
  let used = "plaintext";
  if (code.length > 40_000) {
    html = escape(code);
  } else if (!lang || lang === "auto") {
    const r = hljs.highlightAuto(code, Object.keys(langs).filter((l) => l !== "plaintext"));
    html = r.value;
    used = r.relevance >= 5 && r.language ? r.language : "plaintext";
    if (used === "plaintext") html = escape(code);
  } else {
    html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    used = lang;
  }

  const out: string[] = [];
  const open: string[] = [];
  let line = "";
  const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) { open.push(m[1]); line += m[1]; }
    else if (m[2]) { open.pop(); line += m[2]; }
    else if (m[3]) { out.push(line + "</span>".repeat(open.length)); line = open.join(""); }
    else line += m[4];
  }
  out.push(line + "</span>".repeat(open.length));
  return { lines: out, lang: used };
}

export function plainLines(code: string): string[] {
  return escape(code).split("\n");
}
