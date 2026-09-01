// content-gmgn.js — DETECTOR + WIDGET (redesigned per design_handoff_quickbuy_widget).
// Runs on the detection front-ends (gmgn.ai + basedbot.app). Parses the token from the
// URL and shows a draggable trade HUD that drives the fomo.family tab. gmgn enforces
// Trusted Types → build with createElement/
// textContent, NO innerHTML. init() runs at the bottom (TDZ). Inter font + fomo logo are
// bundled as base64 data URIs in font-data.js (globals FQB_FONT / FQB_LOGO), loaded first.

const LOG = "[FQB/gmgn]";
const HOST_ID = "fqb-host";
const PRESETS_BUY = [10, 100, 500];
const PRESETS_SELL = [25, 50, 100];
const CHAIN_TO_FOMO = { sol: "solana", bsc: "bnb", eth: "ethereum", base: "base", robinhood: "robinhood" };
const ADDR = "(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})";

// Supported detection front-ends. gmgn and basedbot share chain slugs but order the
// path segments differently: gmgn = /<chain>/token/<addr>, basedbot = /token/<chain>/<addr>.
const FRONTENDS = [
  { host: /(^|\.)gmgn\.ai$/i,      re: new RegExp(`^/([a-z0-9]+)/token/(${ADDR})`, "i") },
  { host: /(^|\.)basedbot\.app$/i, re: new RegExp(`^/token/([a-z0-9]+)/(${ADDR})`, "i") },
];

console.log(LOG, "detector loaded on", location.href);

function parseToken() {
  const fe = FRONTENDS.find((f) => f.host.test(location.hostname));
  if (!fe) return null;
  const m = location.pathname.match(fe.re);
  if (!m) return null;
  return { chain: m[1].toLowerCase(), mint: m[2] };
}

function shortMint(mint) {
  return mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("data-")) el.setAttribute(k, v);
    else el[k] = v;
  }
  for (const kid of kids) if (kid) el.appendChild(kid);
  return el;
}

const FONT_FACE = (typeof FQB_FONT !== "undefined")
  ? `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(${FQB_FONT}) format('woff2');}`
  : "";

const WIDGET_CSS = `
  ${FONT_FACE}
  :host { all: initial; }
  * { box-sizing: border-box; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif; }
  .fqb-card { width:292px; background:#101014; border:1px solid rgba(255,255,255,.1); border-radius:16px;
    box-shadow:0 24px 56px rgba(0,0,0,.65),0 2px 8px rgba(0,0,0,.5); overflow:hidden; color:#fff; }

  .fqb-header { display:flex; align-items:center; gap:8px; padding:10px 10px 9px 13px; cursor:grab;
    border-bottom:1px solid rgba(255,255,255,.07); }
  .fqb-header.dragging { cursor:grabbing; }
  .fqb-logo { width:18px; height:18px; border-radius:5px; flex:none; }
  .fqb-wordmark { font-size:13.5px; font-weight:700; letter-spacing:-.01em; }
  .fqb-wordmark span { font-weight:500; color:#8b92a5; }
  .fqb-mode { font-size:9px; font-weight:700; letter-spacing:.08em; padding:3px 7px; border-radius:99px; margin-left:auto; white-space:nowrap; }
  .fqb-mode.dry { background:rgba(245,166,35,.12); color:#f0b04a; }
  .fqb-mode.live { background:#e5484d; color:#fff; display:inline-flex; align-items:center; gap:5px; }
  .fqb-mode.live::before { content:''; width:5px; height:5px; border-radius:99px; background:#fff; animation:fqbpulse 1.2s infinite; }
  @keyframes fqbpulse { 0%,100%{opacity:1} 50%{opacity:.25} }
  .fqb-header-pnl { display:none; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; }
  .fqb-header-pnl.up { color:#2fd390; } .fqb-header-pnl.down { color:#f06166; }
  .fqb-card.fqb-collapsed .fqb-header-pnl { display:inline-flex; margin-left:auto; }
  .fqb-card.fqb-collapsed .fqb-mode { margin-left:8px; }
  .fqb-collapse { width:20px; height:20px; display:grid; place-items:center; border-radius:6px; color:#8b92a5; font-size:14px; cursor:pointer; flex:none; }
  .fqb-collapse:hover { background:rgba(255,255,255,.07); color:#fff; }
  .fqb-card.fqb-collapsed .fqb-body { display:none; }

  .fqb-token { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:11px 13px 0; }
  .fqb-token-left { display:inline-flex; align-items:center; gap:7px; min-width:0; }
  .fqb-chain { font-size:9.5px; font-weight:700; letter-spacing:.05em; padding:3.5px 7px; border-radius:99px; white-space:nowrap; }
  .fqb-chain[data-chain="sol"] { background:rgba(153,69,255,.18); color:#c08bff; }
  .fqb-chain[data-chain="bsc"] { background:rgba(240,185,11,.13); color:#f0c445; }
  .fqb-chain[data-chain="eth"] { background:rgba(98,126,234,.16); color:#93a5f2; }
  .fqb-chain[data-chain="base"] { background:rgba(0,82,255,.18); color:#7aa3ff; }
  .fqb-chain[data-chain="robinhood"] { background:rgba(0,200,5,.13); color:#4fd05a; }
  .fqb-addr { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11.5px; color:#a7adbd;
    cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
  .fqb-addr:hover { color:#fff; }
  .fqb-copy { color:#565d6e; font-size:10px; }
  .fqb-live { display:inline-flex; align-items:center; gap:6px; font-size:10px; font-weight:500; color:#8b92a5; flex:none; }
  .fqb-switch { width:28px; height:16px; border-radius:99px; background:#272b35; position:relative; cursor:pointer; transition:background .12s; }
  .fqb-switch::after { content:''; position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:99px; background:#8b92a5; transition:left .12s,background .12s; }
  .fqb-switch.on { background:#26c281; }
  .fqb-switch.on::after { left:14px; background:#fff; }

  .fqb-pnl { display:flex; align-items:baseline; gap:7px; padding:10px 13px 3px; font-variant-numeric:tabular-nums; }
  .fqb-pnl-val { font-size:16px; font-weight:700; letter-spacing:-.01em; }
  .fqb-pnl-val.up { color:#2fd390; } .fqb-pnl-val.down { color:#f06166; }
  .fqb-pnl-val.muted { color:#6f7688; font-size:12px; font-weight:600; }
  .fqb-pnl-pct { font-size:11.5px; font-weight:600; }
  .fqb-pnl-pct.up { color:rgba(47,211,144,.7); } .fqb-pnl-pct.down { color:rgba(240,97,102,.8); }
  .fqb-pnl-lbl { font-size:9.5px; color:#565d6e; margin-left:auto; letter-spacing:.05em; }

  .fqb-tabs { display:flex; margin:10px 13px 11px; background:#191920; border-radius:10px; padding:3px; }
  .fqb-tab { flex:1; text-align:center; padding:6px 0; border-radius:8px; font-size:12px; font-weight:600; color:#767e91; cursor:pointer; }
  .fqb-tab:hover { color:#c3c9d6; }
  .fqb-tab.active[data-side="buy"] { font-weight:700; background:#2fd390; color:#08130d; }
  .fqb-tab.active[data-side="sell"] { font-weight:700; background:#e5484d; color:#fff; }

  .fqb-amount { margin:0 13px; display:flex; align-items:center; gap:6px; background:#191920; border-radius:10px; padding:9px 12px; }
  .fqb-cur { font-size:17px; color:#565d6e; font-weight:600; }
  .fqb-input { all:unset; font:inherit; font-size:22px; font-weight:700; color:#fff; font-variant-numeric:tabular-nums; letter-spacing:-.01em; width:100%; }
  .fqb-input::placeholder { color:#3d434f; }

  .fqb-presets { display:flex; gap:6px; margin:8px 13px 0; }
  .fqb-preset { flex:1; text-align:center; padding:7px 0; border-radius:9px; background:#191920; color:#a7adbd;
    font-size:12px; font-weight:600; font-variant-numeric:tabular-nums; cursor:pointer; border:none; font-family:inherit; }
  .fqb-preset:hover { background:#20202a; color:#fff; }
  .fqb-preset.active { background:rgba(47,211,144,.16); color:#2fd390; font-weight:700; box-shadow:inset 0 0 0 1px rgba(47,211,144,.45); }
  .fqb-sellpresets .fqb-preset.active { background:rgba(229,72,77,.15); color:#f06166; box-shadow:inset 0 0 0 1px rgba(229,72,77,.45); }
  .fqb-edit { width:30px; flex:none; display:grid; place-items:center; border-radius:9px; background:#191920; color:#767e91; font-size:11px; cursor:pointer; }
  .fqb-edit:hover { color:#fff; background:#20202a; }

  .fqb-editpanel { margin:8px 13px 0; }
  .fqb-editlabel { display:block; font-size:9px; font-weight:700; letter-spacing:.05em; color:#5c6374; margin-bottom:5px; }
  .fqb-editfield { display:flex; gap:6px; }
  .fqb-editinput { flex:1; min-width:0; background:#191920; border:1px solid #272b35; border-radius:9px; padding:7px 9px;
    color:#fff; outline:none; font-size:12px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  .fqb-editsave { flex:none; background:#2fd390; color:#08130d; border:none; border-radius:9px; padding:7px 12px; font-weight:700; cursor:pointer; font-size:12px; font-family:inherit; }
  .fqb-editsave:hover { background:#3ce0a0; }

  .fqb-action { display:block; width:calc(100% - 26px); margin:10px 13px 13px; padding:11px 0; text-align:center; border:none;
    border-radius:11px; font-family:inherit; font-size:13.5px; font-weight:700; cursor:pointer; }
  .fqb-action.buy { background:#2fd390; color:#08130d; } .fqb-action.buy:hover { background:#3ce0a0; }
  .fqb-action.buy:active { background:#28b87e; transform:translateY(1px); }
  .fqb-action.sell { background:#e5484d; color:#fff; } .fqb-action.sell:hover { background:#ec5a5f; }
  .fqb-action:disabled { background:#20242d; color:#5c6374; cursor:not-allowed; transform:none; }

  .fqb-status { text-align:center; font-size:10.5px; padding:0 13px 11px; margin-top:-4px; }
  .fqb-status.muted { color:#6f7688; } .fqb-status.ok { color:#26c281; } .fqb-status.err { color:#f06166; }
  .fqb-hidden { display:none !important; }
`;

let els = {};
let side = "buy";
let amountUsd = PRESETS_BUY[1];
let percent = PRESETS_SELL[1];
let buyPresets = [...PRESETS_BUY];
let sellPresets = [...PRESETS_SELL];
let liveOn = false;
let dryRun = true;
let currentMint = null;

async function init() {
  const host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: "fixed", top: "120px",
    left: `${Math.max(12, window.innerWidth - 312)}px`,
    zIndex: "2147483647", width: "292px",
  });
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = WIDGET_CSS;

  // Header
  const logo = (typeof FQB_LOGO !== "undefined")
    ? h("img", { class: "fqb-logo", src: FQB_LOGO, alt: "fomo" })
    : h("span", { class: "fqb-logo" });
  const wordmark = document.createElement("span");
  wordmark.className = "fqb-wordmark";
  wordmark.appendChild(document.createTextNode("fomo "));
  wordmark.appendChild(h("span", { text: "quickbuy" }));
  const modePill = h("span", { class: "fqb-mode dry", text: "DRY RUN" });
  const headerPnl = h("span", { class: "fqb-header-pnl" });
  const collapseBtn = h("span", { class: "fqb-collapse", text: "–" });
  const header = h("div", { class: "fqb-header" }, logo, wordmark, modePill, headerPnl, collapseBtn);

  // Token row
  const chainBadge = h("span", { class: "fqb-chain", "data-chain": "sol", text: "SOL" });
  const addrText = h("span", { text: "—" });
  const copyGlyph = h("span", { class: "fqb-copy", text: "⧉" });
  const addr = h("span", { class: "fqb-addr", title: "Copy address" }, addrText, copyGlyph);
  const tokenLeft = h("span", { class: "fqb-token-left" }, chainBadge, addr);
  const liveSwitch = h("span", { class: "fqb-switch" });
  const liveWrap = h("span", { class: "fqb-live" }, h("span", { text: "Live" }), liveSwitch);
  const tokenRow = h("div", { class: "fqb-token" }, tokenLeft, liveWrap);

  // PnL row
  const pnlVal = h("span", { class: "fqb-pnl-val", text: "—" });
  const pnlPct = h("span", { class: "fqb-pnl-pct" });
  const pnlLbl = h("span", { class: "fqb-pnl-lbl", text: "UNREALIZED" });
  const pnlRow = h("div", { class: "fqb-pnl" }, pnlVal, pnlPct, pnlLbl);

  // Tabs
  const tabBuy = h("span", { class: "fqb-tab active", "data-side": "buy", text: "Buy" });
  const tabSell = h("span", { class: "fqb-tab", "data-side": "sell", text: "Sell" });
  const tabs = h("div", { class: "fqb-tabs" }, tabBuy, tabSell);

  // Buy view
  const input = h("input", { class: "fqb-input", inputmode: "decimal", placeholder: "0.00", value: String(amountUsd) });
  const amountWrap = h("div", { class: "fqb-amount" }, h("span", { class: "fqb-cur", text: "$" }), input);
  const buyPresetsRow = h("div", { class: "fqb-presets" });
  const editBtn = h("span", { class: "fqb-edit", title: "Edit amounts", text: "✎" });
  const editInput = h("input", { class: "fqb-editinput", placeholder: "10, 100, 500" });
  const editSave = h("button", { class: "fqb-editsave", text: "Save" });
  const editPanel = h("div", { class: "fqb-editpanel fqb-hidden" },
    h("span", { class: "fqb-editlabel", text: "EDIT PRESETS — USD, COMMA-SEPARATED" }),
    h("div", { class: "fqb-editfield" }, editInput, editSave));
  const buyView = h("div", {}, amountWrap, buyPresetsRow, editPanel);

  // Sell view
  const sellPresetsRow = h("div", { class: "fqb-presets fqb-sellpresets" });
  const sellEditBtn = h("span", { class: "fqb-edit", title: "Edit %", text: "✎" });
  const sellEditInput = h("input", { class: "fqb-editinput", placeholder: "25, 50, 100" });
  const sellEditSave = h("button", { class: "fqb-editsave", text: "Save" });
  const sellEditPanel = h("div", { class: "fqb-editpanel fqb-hidden" },
    h("span", { class: "fqb-editlabel", text: "EDIT PRESETS — %, COMMA-SEPARATED" }),
    h("div", { class: "fqb-editfield" }, sellEditInput, sellEditSave));
  const sellView = h("div", { class: "fqb-hidden" }, sellPresetsRow, sellEditPanel);

  const actionBtn = h("button", { class: "fqb-action buy", text: "Buy $100" });
  const status = h("div", { class: "fqb-status fqb-hidden" });

  const body = h("div", { class: "fqb-body" }, tokenRow, pnlRow, tabs, buyView, sellView, actionBtn, status);
  const card = h("div", { class: "fqb-card" }, header, body);

  root.appendChild(style);
  root.appendChild(card);
  document.documentElement.appendChild(host);

  els = { host, root, header, collapseBtn, card, modePill, headerPnl,
          chainBadge, addr, addrText, copyGlyph, liveSwitch,
          pnlVal, pnlPct, pnlLbl, tabBuy, tabSell, buyView, sellView, input,
          buyPresetsRow, editBtn, editInput, editSave, editPanel,
          sellPresetsRow, sellEditBtn, sellEditInput, sellEditSave, sellEditPanel,
          actionBtn, status };
  // edit buttons live inside their preset rows (appended during render)

  wireEvents();
  setupPnl();
  await restoreState();
  refreshForUrl();
  watchUrl();
  console.log(LOG, "widget mounted");
}

function wireEvents() {
  els.collapseBtn.addEventListener("click", async () => {
    const collapsed = els.card.classList.toggle("fqb-collapsed");
    els.collapseBtn.textContent = collapsed ? "+" : "–";
    await chrome.storage.local.set({ fqb_collapsed: collapsed });
  });

  els.tabBuy.addEventListener("click", () => setSide("buy"));
  els.tabSell.addEventListener("click", () => setSide("sell"));

  els.input.addEventListener("input", () => {
    const v = parseFloat(els.input.value);
    amountUsd = isFinite(v) && v > 0 ? v : 0;
    syncUI();
    chrome.storage.local.set({ fqb_amount: amountUsd });
  });

  // Buy preset edit
  els.editBtn.addEventListener("click", () => toggleEdit("buy"));
  els.editSave.addEventListener("click", saveBuyPresets);
  els.editInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBuyPresets(); });

  // Sell preset edit
  els.sellEditBtn.addEventListener("click", () => toggleEdit("sell"));
  els.sellEditSave.addEventListener("click", saveSellPresets);
  els.sellEditInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveSellPresets(); });

  els.liveSwitch.addEventListener("click", () => {
    liveOn = !liveOn;
    chrome.storage.local.set({ fqb_live: liveOn });
    updateLiveSwitch();
    if (liveOn) requestTrack();
  });

  els.addr.addEventListener("click", copyAddr);
  els.actionBtn.addEventListener("click", onTrade);
  makeDraggable();
}

function toggleEdit(which) {
  if (which === "buy") {
    const show = els.editPanel.classList.toggle("fqb-hidden") === false;
    els.buyPresetsRow.classList.toggle("fqb-hidden", show);
    if (show) { els.editInput.value = buyPresets.join(", "); els.editInput.focus(); }
  } else {
    const show = els.sellEditPanel.classList.toggle("fqb-hidden") === false;
    els.sellPresetsRow.classList.toggle("fqb-hidden", show);
    if (show) { els.sellEditInput.value = sellPresets.join(", "); els.sellEditInput.focus(); }
  }
}

function setSide(s) {
  side = s;
  chrome.storage.local.set({ fqb_side: side });
  syncUI();
}

function renderBuyPresets() {
  els.buyPresetsRow.textContent = "";
  for (const p of buyPresets) {
    const b = h("button", { class: "fqb-preset", "data-buy": String(p), text: `$${p}` });
    b.addEventListener("click", () => {
      amountUsd = Number(b.dataset.buy);
      els.input.value = String(amountUsd);
      syncUI();
      chrome.storage.local.set({ fqb_amount: amountUsd });
    });
    els.buyPresetsRow.appendChild(b);
  }
  els.buyPresetsRow.appendChild(els.editBtn);
  syncUI();
}

function saveBuyPresets() {
  const parsed = parsePresetInput(els.editInput.value, (n) => n > 0);
  if (parsed.length) { buyPresets = parsed; chrome.storage.local.set({ fqb_buy_presets: buyPresets }); renderBuyPresets(); }
  els.editPanel.classList.add("fqb-hidden");
  els.buyPresetsRow.classList.remove("fqb-hidden");
}

function renderSellPresets() {
  els.sellPresetsRow.textContent = "";
  for (const p of sellPresets) {
    const b = h("button", { class: "fqb-preset", "data-sell": String(p), text: `${p}%` });
    b.addEventListener("click", () => {
      percent = Number(b.dataset.sell);
      syncUI();
      chrome.storage.local.set({ fqb_percent: percent });
    });
    els.sellPresetsRow.appendChild(b);
  }
  els.sellPresetsRow.appendChild(els.sellEditBtn);
  syncUI();
}

function saveSellPresets() {
  const parsed = parsePresetInput(els.sellEditInput.value, (n) => n > 0 && n <= 100);
  if (parsed.length) { sellPresets = parsed; chrome.storage.local.set({ fqb_sell_presets: sellPresets }); renderSellPresets(); }
  els.sellEditPanel.classList.add("fqb-hidden");
  els.sellPresetsRow.classList.remove("fqb-hidden");
}

function parsePresetInput(str, valid) {
  return str.split(",").map((s) => parseFloat(s.trim()))
    .filter((n) => isFinite(n) && valid(n))
    .filter((n, i, a) => a.indexOf(n) === i)
    .slice(0, 6);
}

function syncUI() {
  const sell = side === "sell";
  els.tabBuy.classList.toggle("active", !sell);
  els.tabSell.classList.toggle("active", sell);
  els.buyView.classList.toggle("fqb-hidden", sell);
  els.sellView.classList.toggle("fqb-hidden", !sell);

  els.actionBtn.classList.toggle("buy", !sell);
  els.actionBtn.classList.toggle("sell", sell);

  if (sell) {
    els.actionBtn.textContent = `Sell ${percent}%`;
    els.actionBtn.disabled = !(percent > 0);
    els.sellPresetsRow.querySelectorAll(".fqb-preset").forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.sell) === percent));
  } else {
    els.actionBtn.textContent = amountUsd > 0 ? `Buy $${amountUsd}` : "Enter amount";
    els.actionBtn.disabled = !(amountUsd > 0);
    els.buyPresetsRow.querySelectorAll(".fqb-preset").forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.buy) === amountUsd));
  }
}

function setStatus(text, kind) {
  els.status.textContent = text || "";
  els.status.className = "fqb-status" + (text ? "" : " fqb-hidden") + (kind ? " " + kind : "");
}

function updateLiveSwitch() { els.liveSwitch.classList.toggle("on", liveOn); }

function updateModePill() {
  els.modePill.textContent = dryRun ? "DRY RUN" : "LIVE";
  els.modePill.className = "fqb-mode " + (dryRun ? "dry" : "live");
}

function copyAddr() {
  if (!currentMint || !navigator.clipboard) return;
  navigator.clipboard.writeText(currentMint).then(() => {
    els.copyGlyph.textContent = "✓";
    setTimeout(() => { els.copyGlyph.textContent = "⧉"; }, 1000);
  }).catch(() => {});
}

async function onTrade() {
  const info = parseToken();
  if (!info || !CHAIN_TO_FOMO[info.chain]) { setStatus("Unsupported chain", "err"); return; }

  const payload = { type: "FOMO_TRADE", mint: info.mint, chain: info.chain, side };
  if (side === "buy") {
    if (!(amountUsd > 0)) { setStatus("Enter an amount", "err"); return; }
    payload.amountUsd = amountUsd;
    setStatus(`Driving fomo tab…`, "muted");
  } else {
    payload.percent = percent;
    setStatus(`Driving fomo tab…`, "muted");
  }

  console.log(LOG, "sending FOMO_TRADE", payload);
  try {
    const res = await chrome.runtime.sendMessage(payload);
    console.log(LOG, "background responded", res);
    if (res && res.ok) { pollResult(info.mint); }
    else { setStatus("✗ " + (res && res.error || "no response"), "err"); }
  } catch (err) {
    console.error(LOG, "sendMessage failed", err);
    setStatus("✗ " + err.message, "err");
  }
}

function pollResult(mint) {
  const t0 = Date.now();
  const iv = setInterval(async () => {
    const { lastResult } = await chrome.storage.local.get("lastResult");
    if (lastResult && lastResult.mint === mint && lastResult.ts >= t0 - 1000) {
      clearInterval(iv);
      const verb = lastResult.side === "sell" ? "Sold" : "Bought";
      if (lastResult.status === "clicked") setStatus(`✓ ${verb} (${lastResult.label})`, "ok");
      else if (lastResult.status === "dry-run") setStatus(`✓ Dry run — would ${lastResult.side}`, "ok");
      else setStatus("✗ " + (lastResult.error || lastResult.status), "err");
    }
    if (Date.now() - t0 > 20000) clearInterval(iv);
  }, 500);
}

function requestTrack() {
  const info = parseToken();
  if (!info) return;
  chrome.runtime.sendMessage({ type: "FOMO_TRACK", mint: info.mint, chain: info.chain }).catch(() => {});
}

function setupPnl() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.pnl) renderPnl(changes.pnl.newValue);
    if (changes.fqb_dryrun) { dryRun = changes.fqb_dryrun.newValue !== false; updateModePill(); }
  });
  chrome.storage.local.get("pnl").then(({ pnl }) => renderPnl(pnl));
}

function renderPnl(pnl) {
  const muted = (t) => {
    els.pnlVal.textContent = t; els.pnlVal.className = "fqb-pnl-val muted";
    els.pnlPct.textContent = ""; els.pnlPct.className = "fqb-pnl-pct";
    els.headerPnl.textContent = ""; els.headerPnl.className = "fqb-header-pnl";
  };
  if (!currentMint) return muted("—");
  if (!pnl || String(pnl.mint).toLowerCase() !== currentMint.toLowerCase()) return muted(liveOn ? "loading…" : "open on fomo");
  if (pnl.none) return muted("No position");
  const arrow = pnl.up ? "▲" : "▼";
  const cls = pnl.up ? "up" : "down";
  els.pnlVal.textContent = `${arrow} ${pnl.pnlUsd}`;
  els.pnlVal.className = "fqb-pnl-val " + cls;
  els.pnlPct.textContent = pnl.pnlPct || "";
  els.pnlPct.className = "fqb-pnl-pct " + cls;
  els.headerPnl.textContent = `${arrow} ${pnl.pnlPct || ""}`;
  els.headerPnl.className = "fqb-header-pnl " + cls;
}

function makeDraggable() {
  const hdr = els.header;
  let sx, sy, sl, st, dragging = false;
  hdr.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".fqb-collapse")) return;
    dragging = true; hdr.classList.add("dragging"); hdr.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY;
    const r = els.host.getBoundingClientRect(); sl = r.left; st = r.top;
  });
  hdr.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const nl = Math.max(0, Math.min(window.innerWidth - 40, sl + (e.clientX - sx)));
    const nt = Math.max(0, Math.min(window.innerHeight - 20, st + (e.clientY - sy)));
    els.host.style.left = `${nl}px`; els.host.style.top = `${nt}px`;
  });
  hdr.addEventListener("pointerup", async (e) => {
    if (!dragging) return;
    dragging = false; hdr.classList.remove("dragging"); hdr.releasePointerCapture(e.pointerId);
    await chrome.storage.local.set({ fqb_pos: { left: els.host.style.left, top: els.host.style.top } });
  });
}

async function restoreState() {
  const s = await chrome.storage.local.get([
    "fqb_pos", "fqb_collapsed", "fqb_amount", "fqb_percent", "fqb_side",
    "fqb_buy_presets", "fqb_sell_presets", "fqb_live", "fqb_dryrun",
  ]);
  if (s.fqb_pos) { els.host.style.left = s.fqb_pos.left; els.host.style.top = s.fqb_pos.top; }
  if (Array.isArray(s.fqb_buy_presets) && s.fqb_buy_presets.length) buyPresets = s.fqb_buy_presets;
  if (Array.isArray(s.fqb_sell_presets) && s.fqb_sell_presets.length) sellPresets = s.fqb_sell_presets;
  if (typeof s.fqb_amount === "number" && s.fqb_amount > 0) { amountUsd = s.fqb_amount; els.input.value = String(amountUsd); }
  if (typeof s.fqb_percent === "number" && s.fqb_percent > 0) percent = s.fqb_percent;
  if (s.fqb_side === "sell" || s.fqb_side === "buy") side = s.fqb_side;
  liveOn = !!s.fqb_live;
  dryRun = s.fqb_dryrun !== false; // default true
  if (s.fqb_collapsed) { els.card.classList.add("fqb-collapsed"); els.collapseBtn.textContent = "+"; }
  updateLiveSwitch();
  updateModePill();
  renderBuyPresets();
  renderSellPresets();
}

function refreshForUrl() {
  const info = parseToken();
  const supported = info && !!CHAIN_TO_FOMO[info.chain];
  els.host.style.display = supported ? "block" : "none";
  if (supported) {
    els.chainBadge.textContent = info.chain.toUpperCase();
    els.chainBadge.setAttribute("data-chain", info.chain);
    els.addrText.textContent = shortMint(info.mint);
    els.addr.title = info.mint;
    setStatus("");
    if (info.mint !== currentMint) {
      currentMint = info.mint;
      chrome.storage.local.get("pnl").then(({ pnl }) => renderPnl(pnl));
      if (liveOn) requestTrack();
    }
    console.log(LOG, "active for", info.chain, "mint", info.mint);
  } else if (info) {
    console.log(LOG, "chain", info.chain, "not supported; widget hidden");
  }
}

function watchUrl() {
  const fire = () => window.dispatchEvent(new Event("fqb:locationchange"));
  for (const m of ["pushState", "replaceState"]) {
    const orig = history[m];
    history[m] = function () { const r = orig.apply(this, arguments); fire(); return r; };
  }
  window.addEventListener("popstate", fire);
  window.addEventListener("fqb:locationchange", refreshForUrl);
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; refreshForUrl(); } }, 1000);
}

// Kick off after all declarations exist.
if (document.getElementById(HOST_ID)) {
  console.log(LOG, "widget already present; skipping");
} else {
  init().catch((e) => console.error(LOG, "init failed", e));
}
