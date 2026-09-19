// AfterHours frontend — fetches ONLY verified live endpoints and renders.
const $ = (sel) => document.querySelector(sel);
const fmt = (n, d = 2) => (n == null ? "—" : (typeof n === "number" ? n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : n));

async function get(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json()).error || r.status);
  return r.json();
}

function renderReferences(refs) {
  const box = $("#refCards");
  box.innerHTML = "";
  for (const [sym, r] of Object.entries(refs)) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = r.error
      ? `<div class="k">${sym}</div><div class="v err">${r.error}</div>`
      : `<div class="k">${sym} · NYSE reference</div>
         <div class="v">$${fmt(r.price)} <small>${r.marketOpen ? "LIVE" : "closed→stale"}</small></div>`;
    box.appendChild(el);
  }
}

function renderUniverse(instruments) {
  $("#univCount").textContent = `${instruments.length} assets`;
  const tbody = $("#univBody");
  tbody.innerHTML = instruments.map((i) => {
    const prem =
      i.markPremium == null ? '<span class="muted">—</span>'
      : i.markPremium >= 0
        ? `<span class="up">+${(i.markPremium * 100).toFixed(2)}%</span>`
        : `<span class="down">${(i.markPremium * 100).toFixed(2)}%</span>`;
    const addr = (i.contractAddress || i.mintAddress || "").slice(0, 6) + "…";
    return `<tr>
      <td><b>${i.symbol}</b><div class="iss">${i.name || ""}</div></td>
      <td class="iss">${i.issuer}</td>
      <td>$${fmt(i.markPrice)}</td>
      <td class="muted">${i.tokenPrice == null ? "—" : "$" + i.tokenPrice.toLocaleString()}</td>
      <td>${prem}</td>
      <td class="muted">$${fmt(i.markValuation ?? i.impliedValuation, 0)}</td>
      <td class="muted">${addr}</td>
    </tr>`;
  }).join("");
}

function renderDislocations(d) {
  const wrap = $("#discWrap");
  if (d.error) { wrap.innerHTML = `<p class="err">${d.error}</p>`; return; }
  wrap.innerHTML = `<div class="muted" style="margin-bottom:8px">${d.count} verified gaps · market ${d.market.open ? `<span class="ok">OPEN</span>` : `<span class="warn">CLOSED</span>`}</div>` +
    `<table><thead><tr><th>Gap</th><th>Instrument</th><th>Type</th><th>Ref→Token</th></tr></thead><tbody>` +
    d.dislocations.map((x) => `<tr>
      <td class="${(x.gapBps||0)>=0?'up':'down'}">${x.gapBps>=0?'+':''}${(x.gapBps/100).toFixed(2)}%</td>
      <td>${x.symbol}</td>
      <td><span class="pill ${x.type}">${x.type === "issuer_premium" ? "premium" : "cross-issuer"}</span></td>
      <td class="muted">${x.note || ""}</td>
    </tr>`).join("") + `</tbody></table>`;
}

function renderRules() {
  const wrap = $("#rulesWrap");
  get("/api/strategies").then((rules) => {
    wrap.innerHTML = rules.length === 0
      ? '<p class="muted" style="margin:0;font-size:13px">No rules yet — add one above.</p>'
      : rules.map((r) => `<div class="rowflex" style="background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:9px 12px;margin-bottom:8px">
          <span>${r.text}</span><span class="muted" style="font-family:var(--mono);font-size:12px">${r.id} · ${r.type}</span>
        </div>`).join("");
    refreshEvaluation();
  }).catch((e) => (wrap.innerHTML = `<p class="err">${e.message}</p>`));
}

async function refreshEvaluation() {
  try {
    const e = await get("/api/strategies/evaluate");
    const wrap = document.createElement("div");
    wrap.innerHTML = e.results.map((r) => {
      const badge = r.fired ? `<span class="pill token_premium">FIRED</span>` : `<span class="pill" style="background:rgba(139,149,176,.14);color:var(--mut)">no match</span>`;
      const match = r.fired ? r.matches.map((m) => `<span class="chip" style="color:var(--acc)">${m.symbol} ${(m.gapBps/100).toFixed(2)}%</span>`).join("") : "";
      return `<div class="rowflex"><div>${badge} ${r.rule.text}</div><div>${match}</div></div>`;
    }).join("");
    const existing = $("#evalRes");
    if (existing) existing.remove();
    const box = document.createElement("div");
    box.id = "evalRes";
    box.style.marginTop = "10px";
    box.style.display = "grid";
    box.style.gap = "8px";
    box.innerHTML = wrap.innerHTML || '<span class="muted">No rules to evaluate.</span>';
    $("#rulesWrap").appendChild(box);
  } catch (e) { /* silent */ }
}

async function load() {
  try {
    const d = await get("/api/dashboard");
    $("#mktBadge").className = "badge " + (d.market.open ? "open" : "closed");
    $("#mktBadge").textContent = d.market.open ? "● NYSE OPEN" : "● MARKET CLOSED";
    renderReferences(d.references || {});
    renderUniverse(d.instruments || []);
    const disc = await get("/api/dislocations");
    renderDislocations(disc);
  } catch (e) {
    $("#refCards").innerHTML = `<div class="card"><div class="k">Status</div><div class="v err">${e.message}</div></div>`;
  }
}

$("#ruleForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = $("#ruleInput").value.trim();
  if (!text) return;
  await fetch("/api/strategies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  $("#ruleInput").value = "";
  renderRules();
});

load();
renderRules();
setInterval(load, 30_000);
// ---- v2 strategy / paper section ----
async function loadV2() {
  try {
    const st = await get("/api/v2/status");
    const enabled = st.enabled;
    $("#runStatus").textContent = enabled ? `● auto-run ${st.intervalMs/1000}s · ${st.runs} runs` : "auto-run off";
  } catch (e) { $("#runStatus").textContent = "off"; }

  try {
    const book = await get("/api/v2/book");
    const a = book.account;
    const pnl = a.peakNavUsd - a.seedUsd;
    $("#acctCards").innerHTML = [
      [`NAV`, `$${a.peakNavUsd.toLocaleString(undefined,{maximumFractionDigits:2})}`],
      [`Seed`, `$${a.seedUsd.toLocaleString(undefined,{maximumFractionDigits:2})}`],
      [`Cash`, `$${a.cashUsd.toLocaleString(undefined,{maximumFractionDigits:2})}`],
      [`PnL`, `<span class="${pnl>=0?'up':'down'}">${pnl>=0?'+':''}$${pnl.toLocaleString(undefined,{maximumFractionDigits:2})}</span>`],
    ].map(([k,v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

    const pos = book.positions || [];
    $("#posBody").innerHTML = pos.map(p => `<tr>
      <td><b>${p.symbol}</b><div class="iss">${p.issuer||""}</div></td>
      <td>${Number(p.shares).toFixed(6)}</td>
      <td>$${Number(p.avgCostUsd).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
      <td class="hide-sm">$${Number(p.valueUsd).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
      <td class="muted hide-sm">$${Number(p.realizedPnlUsd).toLocaleString(undefined,{maximumFractionDigits:2})}</td>
    </tr>`).join("");
    $("#posEmpty").textContent = pos.length===0 ? "No holdings yet — run the strategy to deploy the paper book." : "";
  } catch (e) {
    $("#acctCards").innerHTML = `<div class="card"><div class="k">Paper</div><div class="v err">${e.message}</div></div>`;
  }

  try {
    const dec = await get("/api/v2/decisions?limit=6");
    $("#lastSeq").textContent = dec.length ? `#${dec[dec.length-1].seq}` : "";
    $("#decWrap").innerHTML = dec.length===0 ? '<p class="muted" style="margin:0;font-size:12px">No runs yet.</p>'
      : [...dec].reverse().map(d => `<div class="rowflex" style="background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:8px 12px;margin-bottom:8px;font-size:12px">
          <span class="chip">#${d.seq}</span><span>${d.reason}</span><span class="muted">NAV $${fmt(d.navMicro/1e6)}</span>
        </div>`).join("");
  } catch (e) {}

  try {
    const al = await get("/api/v2/alerts?limit=6");
    $("#alertWrap").innerHTML = al.length===0 ? '<p class="muted" style="margin:0;font-size:12px">No alerts.</p>'
      : al.slice(-6).reverse().map(a => `<div class="rowflex" style="margin-bottom:6px;font-size:12px"><span>${a.payload.text||""}</span><span class="chip">${new Date(a.ts).toLocaleTimeString()}</span></div>`).join("");
  } catch (e) {}
}

async function runStrategy() {
  const btn = $("#runBtn");
  btn.textContent = "Running…"; btn.disabled = true;
  try {
    const r = await fetch("/api/v2/run", { method: "POST" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    const pnl = d.pnlTotal;
    $("#runResult").innerHTML = `<div class="rowflex" style="background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:10px 13px">
      <span>seq <b>#${d.seq}</b></span><span>${d.fills} fills</span>
      <span>NAV <b>$${d.nav.toFixed(2)}</b></span>
      <span class="${pnl>=0?'up':'down'}">PnL ${pnl>=0?'+':''}$${pnl.toFixed(2)}</span>
      <span class="muted">${d.strategy}</span>
    </div>`;
  } catch (e) { $("#runResult").innerHTML = `<p class="err">${e.message}</p>`; }
  btn.textContent = "▶ Run strategy now"; btn.disabled = false;
  loadV2();
}

$("#stratForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = $("#stratInput").value.trim() || "rotate to discounted";
  await fetch("/api/v2/strategies", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ text, type: "rotate_to_discount" }) });
});
$("#runBtn").addEventListener("click", runStrategy);
loadV2();
setInterval(loadV2, 30_000);
