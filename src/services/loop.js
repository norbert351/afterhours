// AfterHours v2 — autonomous strategy run loop.
// Server-authoritative: an interval drives the paper strategy so the book moves
// by itself (the "log actually ran during the competition" pattern). Guards:
//   • one run in flight at a time (a slow upstream never doubles up)
//   • the engine is no-churn, so steady-state ticks log holds, not dust.
import { runEngine } from "./v2.js";

export function startRunLoop(db, { intervalMs = Number(process.env.AH_RUN_INTERVAL_MS || 60_000) } = {}) {
  let timer = null;
  let running = false;
  let runs = 0;
  let lastRunAt = null;
  let nextRunAt = Date.now() + intervalMs;
  let runningSince = null;
  let lastSeq = 0;
  let lastError = null;

  async function tick() {
    if (running) return; // in-flight guard
    running = true;
    runningSince = Date.now();
    try {
      const out = await runEngine(db);
      lastRunAt = Date.now();
      runs += 1;
      lastSeq = out.seq;
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
      lastSeq,
      lastError,
    };
  }

  return { start, stop, status, tick };
}