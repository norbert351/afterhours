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