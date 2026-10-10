"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="empty">
      <h1>We couldn’t load this workspace.</h1>
      <p>
        Please retry. If this persists, ask your administrator to check the
        database configuration.
      </p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
