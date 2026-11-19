import { Wordmark } from "@/components/Wordmark";
import { EntryActions } from "@/components/EntryActions";

export default function Home() {
  return (
    <>
      <header className="bar">
        <Wordmark />
      </header>
      <main className="container entry">
        <div>
          <h1>A room that forgets everything.</h1>
          <p className="lead">Share code, logs and notes live. Nothing survives the hour.</p>
          <EntryActions />
        </div>

        <section className="panels ledger" aria-labelledby="ledger-title">
          <div className="ledger__head">
            <h2 id="ledger-title">What the server keeps</h2>
            <span className="chip chip--cool">per room</span>
          </div>
          <div className="ledger__reading">
            <div className="reading" aria-label="60 minutes">60:00</div>
            <p>On the clock the moment a room opens.</p>
          </div>
          <div>
            <dl>
              <dt>An account</dt><dd>None. There is no sign-up.</dd>
              <dt>Your messages</dt><dd>Until the room is wiped</dd>
              <dt>Your name</dt><dd>In this browser only</dd>
              <dt>Your IP address</dt><dd>60 s in memory, for rate limits</dd>
            </dl>
          </div>
          <div className="ledger__rules">
            <h3>A room is wiped when</h3>
            <ol>
              <li>the clock reaches 00:00, or</li>
              <li>the last person has been gone for 15 s, or</li>
              <li>anyone inside presses burn.</li>
            </ol>
          </div>
        </section>
      </main>
    </>
  );
}
