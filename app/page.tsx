import { getDb } from "@/db/client";
import { feedPractices, type FeedRow } from "@/db/queries";

// Read live data at request time — never at build time — so `next build` and a
// keyless deploy both succeed and render the empty state.
export const dynamic = "force-dynamic";

async function loadFeed(): Promise<FeedRow[]> {
  try {
    return await feedPractices(getDb());
  } catch {
    // No DATABASE_URL or DB unreachable -> render the designed empty state.
    return [];
  }
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-10 py-16 text-center dark:border-zinc-700">
      <h2 className="text-lg font-semibold">No practices in the feed yet</h2>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        The signal detectors haven&apos;t surfaced any buying moments yet. Once a
        detector run writes signals, ranked practices appear here.
      </p>
    </div>
  );
}

export default async function Home() {
  const practices = await loadFeed();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">GTM Maestro</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Practices at a buying moment, ranked by signal count.
        </p>
      </header>

      {practices.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {practices.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
            >
              <div className="flex flex-col">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-zinc-500">
                  {[p.city, p.state].filter(Boolean).join(", ") || "—"} ·{" "}
                  {p.vertical}
                </span>
              </div>
              <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
                {p.signalCount} signal{p.signalCount === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
