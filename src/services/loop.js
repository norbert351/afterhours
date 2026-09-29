// AfterHours v2 — autonomous strategy run loop (multi-tenant).
// Server-authoritative: an interval drives every user's paper strategy so each
// book moves by itself (the "log actually ran during the competition" pattern).
// Guards:
//   • one run in flight at a time (a slow upstream never doubles up)
//   • each user's book is isolated (ownership scoped by user_id)
import { runEngine } from "./v2.js";

// Distinct users with at least one enabled non-alert strategy.
export function activeUserIds(db) {
  const rows = db.prepare(
    "SELECT DISTINCT user_id FROM strategies WHERE enabled = 1 AND strategy_type != 'alert'"
  ).all();
  if (!rows.length) return [0]; // default: keep the legacy/system book alive
  return rows.map((r) => r.user_id);
}

export function startRunLoop(db, { intervalMs = Number(process.env.AH_RUN_INTERVAL_MS || 60_000) } = {}) {
  let timer = null;
  let running = false;
  let runs = 0;
  let lastRunAt = null;
  let nextRunAt = Date.now() + intervalMs;
  let runningSince = null;
  let lastUsersN = 0;
  let lastSeq = 0;
  let lastError = null;

  async function tick() {
    if (running) return; // in-flight guard
    running = true;
    runningSince = Date.now();
    try {
      // Run the engine once per distinct paper user so every autonomous book
      // advances. Shared upstream (universe/dislocation) data is fetched by the
      // engine per call; isolation is guaranteed by user-scoped storage.
      const userIds = activeUserIds(db);
      lastUsersN = userIds.length;
      let last = null;
      for (const uid of userIds) {
        last = await runEngine(db, { userId: uid });
        lastSeq = last.seq;
      }
      lastRunAt = Date.now();
      runs += 1;
      lastError = null;
    } catch (e) {
      lastError = e.message;
      console.error("[v2 loop] run failed:", e.message);
    } finally {
      running = false;
      runningSince = null;
      nextRunAt = Date.now() + intervalMs;
    }
  }

  function start() {
    if (timer) return; // already running
    timer = setInterval(tick, intervalMs);
    tick(); // run immediately on boot
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function status() {
    return {
      enabled: !!timer,
      intervalMs,
      running,
      runs,
      lastRunAt,
      nextRunAt,
      runningSince,
      users: lastUsersN,
      lastSeq,
      lastError,
    };
  }

  return { start, stop, status, tick };
}