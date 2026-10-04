// AfterHours — ONE shared navbar, inherited by every surface (no duplication).
// Self-contained (inline styles) so it renders identically on any page — the
// landing, /app, /bnb, /bitget, /docs. Injects into #ahnav (or prepends to body).
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
    return '<a href="' + href + '" style="color:' + (active ? '#fff' : '#9aa0b0') +
      ';font-size:14px;font-weight:' + (active ? '600' : '500') + ';padding:6px 13px;border-radius:999px;text-decoration:none;background:' +
      (active ? '#5546ff' : 'transparent') + ';border:1px solid ' + (active ? '#5546ff' : 'rgba(255,255,255,.12)') +
      ';transition:.15s">' + label + "</a>";
  }
  var html =
    '<div style="position:sticky;top:0;z-index:999;display:flex;align-items:center;gap:10px;max-width:1120px;margin:0 auto;padding:10px 16px;background:rgba(10,10,15,.90);border:1px solid rgba(255,255,255,.1);border-radius:14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 8px 30px rgba(0,0,0,.35)">' +
      '<a href="/" style="display:flex;align-items:center;gap:9px;color:#fff;font-weight:700;font-size:15px;text-decoration:none;white-space:nowrap">' +
        '<span style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#7a68ff,#5546ff);display:inline-flex;align-items:center;justify-content:center;font-weight:800">A</span>AfterHours</a>' +
      '<span style="flex:1"></span>' +
      link("/app", "Solana", "app") +
      link("/bnb", "BNB", "bnb") +
      link("/bitget", "Bitget", "bitget") +
      '<a href="/docs" style="color:#9aa0b0;font-size:13px;text-decoration:none">Docs</a>' +
    "</div>";
  var el = document.getElementById("ahnav");
  if (el) el.innerHTML = html;
  else {
    var d = document.createElement("div");
    d.innerHTML = html;
    document.body.insertBefore(d.firstChild, document.body.firstChild);
  }
})();