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
// ---- Weekend Gap Vault ----
const VAULT_STATES = { idle: ["IDLE", ""], armed: ["ARMED", "warn"], holding: ["HOLDING", "token_discount"] };
async function loadVault() {
  try {
    const v = await get("/api/vault");
    const [label, cls] = VAULT_STATES[v.status] || [v.status, ""];
    $("#vaultStatus").textContent = `${label} · ${v.execMode ?? v.mode ?? "?"} · capped $${v.capUsd ?? "?"}`;
    $("#vaultStatus").className = "chip " + cls;

    const wsol = v.wallet?.balanceSol ?? null;
    const deployed = (v.positions || []).reduce((a, p) => a + (Number(p.qtyUnits) || 0) * (Number(p.avgPriceUsd) || 0), 0);
    const last = [...(v.fills || [])].pop();
    $("#vaultCards").innerHTML = [
      ["Status", `<span style="color:var(--up)">●</span> ${label}`],
      ["Deployed (at cost)", deployed > 0 ? `$${deployed.toFixed(2)}` : "—"],
      ["Wallet SOL", wsol == null ? "—" : wsol.toFixed(4)],
      ["Last fill", last ? (last.explorer ? `<a href="${last.explorer}" target="_blank" style="color:var(--acc)">${fmtAddr(last.signature)}</a>` : last.symbol + " " + last.side) : "—"],
    ].map(([k, val]) => `<div class="card"><div class="k">${k}</div><div class="v" style="font-size:15px">${val}</div></div>`).join("");

    const pos = v.positions || [];
    $("#vaultPosEmpty").style.display = pos.length ? "none" : "";
    $("#vaultPosEmpty").textContent = v.status === "holding" ? "" : "No position — arm the vault while the market is closed and it deploys into the deepest live gap.";
    $("#vaultPos").innerHTML = pos.map((p) => `<tr>
      <td><b>${p.symbol}</b><div class="iss">gap ${p.gapPctAtBuy == null ? "—" : p.gapPctAtBuy.toFixed(2) + "%"}</div></td>
      <td>${fmt(p.qtyUnits, 6)}</td>
      <td>${p.gapPctAtBuy == null ? "—" : p.gapPctAtBuy.toFixed(2) + "%"}</td>
      <td class="hide-sm">${p.mode}</td>
      <td>${p.explorer ? `<a href="${p.explorer}" target="_blank" style="color:var(--acc)">${fmtAddr(p.tx)}</a>` : "—"}</td>
    </tr>`).join("");

    const fills = (v.fills || []).slice(-8).reverse();
    $("#vaultFills").innerHTML = fills.length === 0 ? "" :
      '<div class="muted" style="font-size:11px;margin:6px 0 4px">Recent fills</div>' +
      fills.map((f) => `<div class="rowflex" style="font-size:12px;margin-bottom:4px">
        <span><span class="${f.side === "buy" ? "up" : "down"}">${f.side.toUpperCase()}</span> ${f.symbol} ${f.mode === "real" ? "" : "· paper"} ${f.note || ""}</span>
        <span>${f.explorer ? `<a href="${f.explorer}" target="_blank" style="color:var(--acc)">${fmtAddr(f.signature)}</a>` : ""}<span class="chip">${new Date(f.ts).toLocaleTimeString()}</span></span>
      </div>`).join("");
    let m = v.bestGap
      ? "Market " + (v.marketOpen ? "OPEN — vault will unwind at the open" : "CLOSED — deepest live gap: " + v.bestGap.symbol + " " + (v.bestGap.gapPct >= 0 ? "+" : "") + v.bestGap.gapPct.toFixed(2) + "%") + "."
      : (v.marketOpen == null ? "" : "No tradeable gap right now.");
    if (v.lastError) m += " · " + v.lastError;
    $("#vaultMsg").textContent = m;
  } catch (e) {
    $("#vaultStatus").textContent = "offline";
    $("#vaultMsg").textContent = "vault error: " + e.message;
  }
}
async function vaultAction(path, verb) {
  if (verb && !confirm(verb)) return;
  const btn = document.activeElement; if (btn) btn.disabled = true;
  try {
    const r = await fetch("/api/vault/" + path, { method: "POST" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    $("#vaultMsg").textContent = d.action ? `→ ${d.action}` : "";
    if (d.error) $("#vaultMsg").textContent = d.error;
  } catch (e) { $("#vaultMsg").textContent = "vault error: " + e.message; }
  if (btn) btn.disabled = false;
  loadVault();
}
$("#vaultArm").addEventListener("click", () => vaultAction("arm", "Arm the vault? It will buy the deepest live gap with real SOL (capped ≈$0.25/fill)."));
$("#vaultStop").addEventListener("click", () => vaultAction("stop", "Stop the vault?"));
$("#vaultUnwind").addEventListener("click", () => vaultAction("unwind", "Unwind all positions to SOL now?"));
loadVault();
setInterval(loadVault, 30_000);

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
    const pos = book.positions || [];
    const held = pos.reduce((s,p)=>s+(Number(p.valueUsd)||0),0);
    const nav = a.cashUsd + held;                 // CURRENT NAV = cash + open positions
    const pnl = nav - a.seedUsd;                   // live PnL (not the high-water peak)
    $("#acctCards").innerHTML = [
      [`NAV`, `$${nav.toLocaleString(undefined,{maximumFractionDigits:2})}`],
      [`Seed`, `$${a.seedUsd.toLocaleString(undefined,{maximumFractionDigits:2})}`],
      [`Cash`, `$${a.cashUsd.toLocaleString(undefined,{maximumFractionDigits:2})}`],
      [`PnL`, `<span class="${pnl>=0?'up':'down'}">${pnl>=0?'+':''}$${pnl.toLocaleString(undefined,{maximumFractionDigits:2})}</span>`],
    ].map(([k,v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
    $("#acctCards").classList.toggle("nonzero", pos.length>0);

    $("#posEmpty").style.display = pos.length?"none":"";
    $("#posEmpty").textContent = "No open holdings right now — the strategy is idle because no tokenized equity is trading below its mark in this live snapshot. Watch a live gap, or connect a wallet to execute.";
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

// ---- v4 accounts + watchlist (navbar + modal) ----
let me = null;
function fmtAddr(h){ return (h||'').length>14 ? h.slice(0,4)+'…'+h.slice(-4) : h; }
async function checkAuth() {
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin" });
    const b = $("#btnWallet");
    if (r.ok) {
      me = await r.json();
      b.textContent = "@" + fmtAddr(me.handle);
      b.classList.add("signed");
      b.onclick = signOutConfirm;
    } else {
      me = null;
      b.textContent = "Connect wallet";
      b.classList.remove("signed");
      b.onclick = openAuth;
    }
    renderWatchlist();
  } catch (e) { me = null; }
}
function openAuth(){ $("#authModal").classList.add("show"); $("#authMsg").textContent="Secure · keys stay with you"; }
function closeAuth(){ $("#authModal").classList.remove("show"); }
async function signOutConfirm(){ if(confirm("Sign out of "+fmtAddr(me?.handle)+"?")){ await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"}); closeAuth(); checkAuth(); } }
async function doAuth(path) {
  const h = $("#ahHandle").value.trim(), p = $("#ahPass").value;
  if (!h || !p) { $("#authMsg").textContent="Enter a handle and password"; return; }
  if (path==="register" && p.length<6) { $("#authMsg").textContent="Password must be ≥ 6 characters"; return; }
  const r = await fetch("/api/auth/"+path, { method:"POST", headers:{"Content-Type":"application/json"}, credentials:"same-origin", body: JSON.stringify({handle:h,password:p}) });
  const d = await r.json().catch(()=>({}));
  $("#authMsg").textContent = d.error ? d.error : (path==="register"?"Account created ✓":"Signed in ✓");
  if (r.ok) { $("#ahPass").value=""; closeAuth(); checkAuth(); }
}
async function renderWatchlist() {
  const w = $("#watchStrip");
  if (!me) { w.hidden = true; return; }
  try {
    const r = await fetch("/api/watchlist", { credentials:"same-origin" });
    if (!r.ok) { w.hidden = true; return; }
    const list = await r.json();
    if (!list.length) { w.hidden = true; return; }
    w.hidden = false;
    w.innerHTML = '<span class="muted" style="font-size:11px;align-self:center">Watching:</span>' +
      list.map(x=>`<span class="wchip">${x.symbol} ${x.price?("$"+Number(x.price).toFixed(2)):""} <a href="#" data-rm="${x.symbol}" style="color:var(--down);text-decoration:none">✕</a></span>`).join("");
    w.querySelectorAll("a[data-rm]").forEach(a=>a.addEventListener("click", async (ev)=>{ ev.preventDefault(); await fetch("/api/watchlist/"+a.getAttribute("data-rm"),{method:"DELETE",credentials:"same-origin"}); checkAuth(); }));
  } catch(e){ w.hidden=true; }
}
$("#btnWallet").addEventListener("click", openAuth);
const introBtn = document.getElementById("introConnect"); if (introBtn) introBtn.addEventListener("click", openAuth);
$("#authClose").addEventListener("click", closeAuth);
$("#authModal").addEventListener("click", (e)=>{ if(e.target.id==="authModal") closeAuth(); });
$("#btnLogin").addEventListener("click", () => doAuth("login"));
$("#btnRegister").addEventListener("click", () => doAuth("register"));
$("#mWallet").addEventListener("click", async () => { $("#authMsg").textContent="Opening wallet…"; await connectWallet(); });
checkAuth();
setInterval(checkAuth, 60_000);

// ---- Market never sleeps: live on-chain gaps ----
async function renderGaps() {
  try {
    const d = await get("/api/markethours/gap");
    $("#gapOpen").textContent = d.marketOpen ? "● NYSE OPEN" : "● MARKET CLOSED (STALE REF)";
    $("#gapHint").textContent = d.marketOpen
      ? "NYSE open — on-chain trades alongside the live reference."
      : "NYSE closed — tokenized equities still trade 24/7 on-chain; the reference is the frozen close. The gap is the real signal.";
    $("#gapBody").innerHTML = d.gaps.filter(g=>!g.error).map(g => {
      const gap = typeof g.gapPct==="number" ? g.gapPct : 0;
      const cls = gap>=0 ? "up" : "down";
      return `<tr><td><b>${g.symbol}</b><div class="iss">${g.ref}</div></td>
        <td>$${Number(g.onChainPriceUsd).toFixed(2)}</td>
        <td class="muted">${g.referencePriceUsd?("$"+Number(g.referencePriceUsd).toFixed(2)):"—"}</td>
        <td class="${cls}">${gap>=0?"+":""}${gap.toFixed(2)}%</td>
        <td class="muted hide-sm">$${(Number(g.volumeUsd24h||0)/1e3).toFixed(0)}k</td></tr>`;
    }).join("") || '<tr><td colspan="5" class="muted">no live data</td></tr>';
  } catch (e) {}
}
renderGaps();
setInterval(renderGaps, 45_000);

// ---- Connect wallet (custom Solana sign-in) ----
async function connectWallet() {
  // Privy path (auth island mounted on the page) — else native Solana.
  if (window.__privyLogin) { await window.__privyLogin(); closeAuth(); checkAuth(); return; }
  const el = window.solana;
  if (!el || !el.isConnected) {
    $("#authMsg").textContent = "Install a Solana wallet (e.g. Phantom) to connect.";
    return;
  }
  try {
    const resp = await el.connect();
    const address = (resp?.publicKey || el.publicKey).toString();
    $("#authMsg").textContent = "Requesting signature…";
    const ch = await (await fetch("/api/auth/wallet/challenge", { method:"POST", headers:{"Content-Type":"application/json"}, credentials:"same-origin", body: JSON.stringify({address}) })).json();
    const sig = await el.signMessage(new TextEncoder().encode(ch.message), "utf8");
    const sigBytes = (sig.signature ?? sig);
    const v = await (await fetch("/api/auth/wallet/verify", { method:"POST", headers:{"Content-Type":"application/json"}, credentials:"same-origin", body: JSON.stringify({ address, signature: Array.from(sigBytes) }) })).json();
    $("#authMsg").textContent = v.error ? v.error : ("Wallet connected ✓");
    if (!v.error) { closeAuth(); checkAuth(); }
  } catch (e) {
    $("#authMsg").textContent = "connect error: " + (e.message || e);
  }
}
