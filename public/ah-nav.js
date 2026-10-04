// AfterHours — ONE shared navbar, inherited by every surface (no duplication).
// Self-contained (inline styles + injected <style>) so it renders identically.
// Desktop: brand + product links inline. Mobile: links collapse behind a ☰ menu.
(function () {
  function cur() {
    var p = location.pathname;
    if (p.indexOf("/bitget") === 0) return "bitget";
    if (p.indexOf("/bnb") === 0) return "bnb";
    if (p.indexOf("/app") === 0) return "app";
    if (p.indexOf("/docs") === 0) return "docs";
    return "home";
  }
  var a = cur();
  function link(href, label, key) {
    var active = key === a;
    return '<a href="' + href + '" data-k="' + key + '" style="color:' + (active ? '#fff' : '#cdd3e0') +
      ';font-size:14px;font-weight:600;padding:9px 14px;border-radius:10px;text-decoration:none;display:block;text-align:left;background:' +
      (active ? '#5546ff' : 'transparent') + ';transition:.15s">' + label + "</a>";
  }
  var id = "ahn_" + Math.random().toString(36).slice(2, 8);
  // raw CSS (no <style> wrapper)
  var css =
    "." + id + "{position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:10px;max-width:1120px;margin:0 auto;padding:10px 14px;background:rgba(10,10,15,.92);border:1px solid rgba(255,255,255,.1);border-radius:14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 8px 30px rgba(0,0,0,.35)}" +
    "." + id + " .ahlinks{display:flex;gap:6px;align-items:center;margin-left:auto}" +
    "." + id + " .ahmenu{display:none}" +
    "@media(max-width:720px){" +
      "." + id + "{top:8px;justify-content:space-between}" +
      "." + id + " .ahmenu{display:inline-flex}" +
      "." + id + " .ahlinks{display:none;position:absolute;top:calc(100% - 4px);left:0;right:0;flex-direction:column;align-items:stretch;gap:4px;margin-left:0;background:rgba(10,10,15,.97);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:10px;box-shadow:0 18px 44px rgba(0,0,0,.55)}" +
      "." + id + " .ahlinks.open{display:flex}" +
      "." + id + " .ahlinks a{text-align:left;width:100%}" +
    "}";
  var brand =
    '<a href="/" style="display:flex;align-items:center;gap:9px;color:#fff;font-weight:700;font-size:15px;text-decoration:none;white-space:nowrap">' +
      '<span style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#7a68ff,#5546ff);display:inline-flex;align-items:center;justify-content:center;font-weight:800">A</span>AfterHours</a>';
  var btn = '<button type="button" aria-label="Menu" class="ahmenu" style="align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);cursor:pointer;color:#fff;font-size:20px;line-height:1">☰</button>';
  var links =
    '<div class="ahlinks">' +
      link("/app", "Solana", "app") +
      link("/bnb", "BNB", "bnb") +
      link("/bitget", "Bitget", "bitget") +
      '<a href="/docs" data-k="docs" style="color:#8b96a8;font-size:13px;text-decoration:none;padding:8px 12px">Docs</a>' +
    "</div>";

  var el = document.getElementById("ahnav");
  if (el) {
    el.className = id;
    var sd = document.createElement("style");
    sd.textContent = css;
    el.innerHTML = brand + btn + links;
    el.appendChild(sd);
  } else {
    var d = document.createElement("div");
    d.id = "ahn";
    d.innerHTML = brand + btn + links;
    var st = document.createElement("style");
    st.textContent = css;
    document.body.appendChild(st);
    document.body.insertBefore(d, document.body.firstChild);
    el = d;
  }
  var linksEl = el.querySelector(".ahlinks"), menuBtn = el.querySelector(".ahmenu");
  document.addEventListener("click", function (e) {
    if (!el.contains(e.target)) return;
    if (menuBtn && e.target.closest(".ahmenu")) {
      e.preventDefault();
      linksEl.classList.toggle("open");
    } else if (e.target.closest("a") && linksEl.classList.contains("open")) {
      linksEl.classList.remove("open");
    }
  });
})();