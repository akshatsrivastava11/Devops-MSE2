"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { normaliseRoomId } from "@/lib/protocol";

export function EntryActions() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");

  async function create() {
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (res.status === 429) throw new Error("Too many rooms from this address. Try again in a minute.");
      if (!res.ok) throw new Error("The server could not open a room. Try again.");
      const { id } = (await res.json()) as { id: string };
      router.push(`/r/${id}`);
    } catch (err) {
      setCreateError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Could not reach the server.");
      setCreating(false);
    }
  }

  function join(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = normaliseRoomId(code);
    if (!id) {
      setJoinError("A room code looks like k7mp-x9qa.");
      (e.currentTarget.elements.namedItem("code") as HTMLInputElement).focus();
      return;
    }
    router.push(`/r/${id}`);
  }

  return (
    <div className="entry__actions">
      <div>
        <button type="button" className="btn btn--primary btn--large" onClick={create} disabled={creating} data-busy={creating}>
          {creating ? "Opening room" : "Open a room"}
        </button>
        <p className="helper" data-tone={createError ? "bad" : undefined} role={createError ? "alert" : undefined}>
          {createError}
        </p>
      </div>
      <form className="join" onSubmit={join} noValidate>
        <label className="field-label" htmlFor="code">Have a code or a link?</label>
        <div className="join__row">
          <input
            id="code" name="code" className="input" placeholder="k7mp-x9qa" autoComplete="off" spellCheck={false}
            autoCapitalize="none" value={code} aria-invalid={joinError ? true : undefined} aria-describedby="code-help"
            onChange={(e) => { setCode(e.target.value); setJoinError(""); }}
          />
          <button type="submit" className="btn btn--large">Join</button>
        </div>
        <p id="code-help" className="helper" data-tone={joinError ? "bad" : undefined}>{joinError}</p>
      </form>
    </div>
  );
}
