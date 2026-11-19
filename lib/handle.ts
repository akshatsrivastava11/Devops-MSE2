const A = ["amber", "brisk", "calm", "dusty", "eager", "faint", "gentle", "hollow", "idle", "jolly", "keen", "lucid", "mellow", "nimble", "odd", "plain", "quiet", "rapid", "sly", "tidy", "vivid", "wry"];
const N = ["otter", "heron", "lynx", "moth", "newt", "owl", "panda", "quail", "raven", "seal", "tapir", "vole", "wren", "yak", "badger", "crane", "dingo", "egret", "ferret", "gecko", "ibis", "koala"];

const KEY = "burnroom:name";

function pick<T>(xs: T[]) {
  return xs[Math.floor(Math.random() * xs.length)];
}

export function loadName(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
  } catch {}
  const name = `${pick(A)}-${pick(N)}`;
  saveName(name);
  return name;
}

export function saveName(name: string) {
  try {
    localStorage.setItem(KEY, name);
  } catch {}
}
