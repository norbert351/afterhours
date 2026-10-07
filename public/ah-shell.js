/* ============================================================
   AfterHours · shared UI shell, ONE navbar, menu, chain switcher
   rendered on every route. Reads window.AH (per-page config).
   ============================================================ */
(function () {
  var cfg = window.AH || {};
  var LOGO = cfg.logo || "/logo.png";
  var route = cfg.route || "home";
  var action = cfg.action || (route === "home" ? "openapp" : "wallet");
  var chain = cfg.chain || (route === "bnb" ? "bnb" : route === "bitget" ? "bga" : "sol");
  var showChain = cfg.showChain !== false;
  var onConnect = cfg.onConnect || function () { location.href = "/app"; };

  var chainLink = {
    sol: { href: "/app", label: "Solana" },
    bnb: { href: "/bnb", label: "BNB" },
    bga: { href: "/bitget", label: "Bitget" },
  };

  function active(key) { return route === key; }

  // navbar
  var nav = document.createElement("header");
  nav.className = "ah-nav";
  nav.innerHTML =
    '<a class="ah-brand" href="/" aria-label="AfterHours home">' +
      '<img src="' + LOGO + '" alt="" width="32" height="32">' +
      '<span>AfterHours</span>' +
    "</a>" +
    '<div class="ah-actions">' +
      (action === "openapp"
        ? '<a class="ah-action primary" href="/app">Open app</a>'
        : '<button class="ah-action ghost" id="ahWallet" type="button">Connect wallet</button>') +
      '<button class="ah-burger" id="ahBurger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="ahMenu">☰</button>' +
    "</div>";

  // chain switcher (sticky, under navbar)
  var chainWrap = null;
  if (showChain) {
    chainWrap = document.createElement("div");
    chainWrap.className = "ah-chainwrap";
    chainWrap.innerHTML =
      '<nav class="ah-chain" aria-label="Chain">' +
        '<a class="ch sol' + (chain === "sol" ? " on" : "") + '" href="/app"><span class="sw"></span>Solana</a>' +
        '<a class="ch bnb' + (chain === "bnb" ? " on" : "") + '" href="/bnb"><span class="sw"></span>BNB</a>' +
        '<a class="ch bga' + (chain === "bga" ? " on" : "") + '" href="/bitget"><span class="sw"></span>Bitget</a>' +
      "</nav>";
  }

  // mobile menu (slide-over) + backdrop
  var backdrop = document.createElement("div");
  backdrop.className = "ah-menu-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  var menu = document.createElement("div");
  menu.className = "ah-menu";
  menu.id = "ahMenu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-modal", "true");
  menu.setAttribute("aria-label", "Main menu");
  menu.innerHTML =
    '<div class="ah-menu-head">' +
      '<span class="hm-brand"><img src="' + LOGO + '" alt="" width="30" height="30"><b>AfterHours</b></span>' +
      '<button class="hm-close" id="ahMenuClose" aria-label="Close menu" type="button">✕</button>' +
    "</div>" +
    '<nav aria-label="Primary">' +
      '<p class="mi-sec">Product</p>' +
      '<a class="mi' + (route === "home" ? " active" : "") + '" href="/">Home</a>' +
      '<a class="mi' + (route === "now" ? " active" : "") + '" href="/now">Now · live dislocations</a>' +
      '<a class="mi' + (route === "sleep" ? " active" : "") + '" href="/sleep">Sleep Mode · Autopilot</a>' +
      '<a class="mi' + (route === "proof" ? " active" : "") + '" href="/proof">Proof</a>' +
      '<p class="mi-sec">Venues</p>' +
      '<a class="mi chain-sol' + (chain === "sol" ? " active" : "") + '" href="/app"><span class="swatch"></span><span class="mi-label">Solana</span></a>' +
      '<a class="mi chain-bnb' + (chain === "bnb" ? " active" : "") + '" href="/bnb"><span class="swatch"></span><span class="mi-label">BNB</span></a>' +
      '<a class="mi chain-bitget' + (chain === "bga" ? " active" : "") + '" href="/bitget"><span class="swatch"></span><span class="mi-label">Bitget</span></a>' +
      '<p class="mi-sec">Resources</p>' +
      '<a class="mi' + (route === "docs" ? " active" : "") + '" href="/docs">How it works · Docs</a>' +
      '<button class="hm-connect" id="ahMenuConnect" type="button">Connect wallet</button>' +
    "</nav>" +
    '<div class="ah-menu-foot">AfterHours · Tokenized equities, 24/7</div>';

  // mount
  var mount = document.getElementById("ahnav");
  if (mount) { mount.replaceWith(nav); } else { document.body.insertBefore(nav, document.body.firstChild); }
  if (chainWrap) nav.after(chainWrap);
  document.body.appendChild(backdrop);
  document.body.appendChild(menu);

  // ---- menu open/close ----
  var burger = document.getElementById("ahBurger");
  var menuEl = menu, bd = backdrop;
  function openMenu() {
    burger.setAttribute("aria-expanded", "true");
    document.body.classList.add("open-ah", "ah-lock");
    focusFirst(menuEl);
  }
  function closeMenu() {
    burger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("open-ah", "ah-lock");
    burger.focus();
  }
  function focusFirst(root) {
    var f = root.querySelector("a,button");
    if (f) f.focus();
  }
  burger.addEventListener("click", openMenu);
  document.getElementById("ahMenuClose").addEventListener("click", closeMenu);
  bd.addEventListener("click", closeMenu);
  // close on route click
  menuEl.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeMenu); });
  // context connect actions
  function connect() {
    if (action !== "openapp") { closeMenu(); onConnect(); }
  }
  document.getElementById("ahWallet") && document.getElementById("ahWallet").addEventListener("click", connect);
  document.getElementById("ahMenuConnect").addEventListener("click", connect);

  // Esc + focus trap
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeMenu(); return; }
    if (e.key === "Tab" && document.body.classList.contains("open-ah")) {
      var focusables = menuEl.querySelectorAll('a[href],button:not([disabled])');
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  // close on route change (SPA-ish)
  window.addEventListener("popstate", closeMenu);
})();