import Link from "next/link";

export default function NotFound() {
  return (
    <main className="state">
      <h1>Nothing at this address.</h1>
      <p>Rooms live at /r/ followed by their code.</p>
      <div className="state__actions"><Link className="btn btn--primary" href="/">Go to the start</Link></div>
    </main>
  );
}
