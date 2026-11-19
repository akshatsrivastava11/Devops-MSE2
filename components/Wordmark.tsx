import Link from "next/link";

export function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="Burnroom, home">
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <rect x="1.5" y="1.5" width="15" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 12.5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5 9h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
        <path d="M5 5.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
      </svg>
      burnroom
    </Link>
  );
}
