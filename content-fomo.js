// content-fomo.js — the EXECUTOR. Runs on fomo.family. When it loads (or the URL
// changes) it checks storage for a pendingTrade whose mint matches the token page it
// is on, then switches the panel to Buy/Sell mode, sets the amount (USD preset for buy,
// % preset for sell), and clicks "Buy <TOKEN>" / "Sell <TOKEN>". Dry-run does everything
// except the final click.

const LOG = "[FQB/fomo]";
const ADDR = /^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})$/;
const PENDING_MAX_AGE_MS = 60_000;

console.log(LOG, "executor loaded on", location.href);

// ---- utilities --------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(fn, { timeout = 15000, interval = 200, label = "element" } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      let v = null;
      try { v = fn(); } catch (_) { v = null; }
      if (v) return resolve(v);
      if (Date.now() - t0 > timeout) return reject(new Error(`waitFor timeout: ${label}`));
      setTimeout(poll, interval);
    })();
  });
}

// React controlled <input>: bypass React's instance value setter, reset _valueTracker,
// fire a real InputEvent so React's state actually updates. (Only used for custom buy
// amounts — presets and all sells go through fomo's own buttons.)
function reactSetInput(el, value) {
  el.focus();
  const proto = Object.getPrototypeOf(el);
  const setter = (
    Object.getOwnPropertyDescriptor(proto, "value") ||
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
  ).set;
  if (el._valueTracker) el._valueTracker.setValue("");
  setter.call(el, value);
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---- selectors --------------------------------------------------------------

// Amount input: the only input with placeholder="0" (search box is a different one).
// Present in both Buy and Sell modes, so also serves as a "panel ready" probe.
function getAmountInput() {
  return document.querySelector('input[placeholder="0"]');
}

// Mode toggle button (type=button, exact text "Buy" or "Sell").
function getToggle(verb) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.type === "button" && b.textContent.trim() === verb
  );
}

// Execute button for a given verb: any button whose text is "Buy <TOKEN>" /
// "Sell <TOKEN>". We match by text across ALL buttons and ignore the `type` attribute
// entirely — fomo omits it, so `button[type=submit]` (an attribute selector) misses
// these even though the DOM property defaults to "submit". The `\s+\S` guard means the
// bare "Buy"/"Sell" toggle buttons never match. Only the current mode's button renders,
// so this also detects mode.
function getExecuteButton(verb) {
  const re = new RegExp(`^${verb}\\s+\\S`, "i");
  return [...document.querySelectorAll("button")].find((b) =>
    re.test(b.textContent.trim().replace(/\s+/g, " "))
  ) || null;
}

// Current panel mode, detected by which preset type is showing. The trade panel's
// presets carry class "hover-scrim"; in Buy mode they're all "$…", in Sell mode "…%".
// (Position-row $/% buttons don't have hover-scrim, so they don't interfere.) This is
// far more reliable than reading the toggle's active color class.
function currentMode() {
  const presets = [...document.querySelectorAll("button")].filter((b) => /hover-scrim/.test(b.className));
  const hasUsd = presets.some((b) => /^\$\d/.test(b.textContent.trim()));
  const hasPct = presets.some((b) => /%$/.test(b.textContent.trim()));
  if (hasUsd && !hasPct) return "buy";
  if (hasPct && !hasUsd) return "sell";
  return null; // unknown / not rendered yet
}

// Fomo's own preset buttons in the trade panel. Class "hover-scrim" distinguishes them
// from the position quick-action presets elsewhere. label is "$100" (buy) or "50%" (sell).
function getFomoPreset(label) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === label && /hover-scrim/.test(b.className)
  );
}

function parseFomoMint() {
  const m = location.pathname.match(/^\/tokens\/([a-z]+)\/([^/?#]+)/i);
  if (!m) return null;
  return { chain: m[1].toLowerCase(), mint: m[2] };
}

// ---- confirmation warning (unverified-token gate) ---------------------------
const WARN_RE = /understand|unverified|not verified|risk|aware|are you sure|proceed|acknowledg|i agree|confirm|caution/i;

function isVisible(el) {
  return !!(el && (el.offsetParent || el.getClientRects().length));
}

// Text of the checkbox's surroundings (a few ancestors up) — used to decide whether a
// checkbox is a warning acknowledgement vs. some unrelated toggle.
function nearbyText(el) {
  let node = el, depth = 0, txt = "";
  while (node && depth < 4) { txt += " " + (node.textContent || ""); node = node.parentElement; depth++; }
  return txt.toLowerCase();
}

// fomo's risk gate is a CUSTOM checkbox: a row with TWO sibling <button>s — an orange
// square (the checkbox) and an accordion toggle holding "…I understand the risks…" +
// a chevron. The checkbox is the sibling button that ISN'T the accordion. Clicking the
// accordion just collapses the warning, so we must click the square specifically.
const ACK_RE = /i understand.*(risk|trading this token)|understand the risks/i;

function findRiskCheckbox() {
  const ackSpan = [...document.querySelectorAll("span")].find(
    (e) => ACK_RE.test(e.textContent) && e.textContent.trim().length < 120
  );
  if (!ackSpan) return null;
  const accordion = ackSpan.closest("button");
  const row = accordion ? accordion.parentElement : ackSpan.closest("div");
  if (!row) return null;
  const btns = [...row.querySelectorAll(":scope > button")];
  return btns.find((b) => b !== accordion) || null; // the square, not the accordion
}

// Tick any confirmation gate: native/role checkboxes near warning text or in a modal,
// plus fomo's custom "I understand the risks" acknowledgement. Returns how many ticked.
function tickWarningCheckboxes() {
  let ticked = 0;

  // Native / ARIA checkboxes.
  const boxes = [...document.querySelectorAll('input[type=checkbox], [role=checkbox]')].filter(isVisible);
  for (const c of boxes) {
    const isNative = c.matches("input[type=checkbox]");
    const checked = isNative ? c.checked : c.getAttribute("aria-checked") === "true";
    if (checked) continue;
    if (c.closest('[role=dialog], [data-slot*=dialog], [class*=modal]') || WARN_RE.test(nearbyText(c))) {
      console.log(LOG, "ticking warning checkbox:", c.outerHTML.slice(0, 140));
      c.click();
      ticked++;
    }
  }

  // fomo's custom "I understand the risks" acknowledgement (only if the execute button
  // is still disabled — avoids toggling an already-ticked box back off).
  const stillDisabled = ["Buy", "Sell"].some((v) => { const b = getExecuteButton(v); return b && b.disabled; });
  if (stillDisabled) {
    const box = findRiskCheckbox();
    if (box) {
      console.log(LOG, "ticking risk checkbox (I understand the risks)");
      box.click();
      ticked++;
    }
  }
  return ticked;
}

// After ticking, a modal may present a separate confirm button — click the enabled one.
function clickModalConfirm() {
  const btns = [...document.querySelectorAll('[role=dialog] button, [data-slot*=dialog] button, [class*=modal] button')]
    .filter((b) => isVisible(b) && !b.disabled);
  const btn = btns.find((b) => /confirm|understand|proceed|continue|agree|sure|accept|buy|sell/i.test(b.textContent));
  if (btn) { console.log(LOG, "clicking modal confirm:", JSON.stringify(btn.textContent.trim())); btn.click(); return true; }
  return false;
}

// ---- main flow --------------------------------------------------------------

async function maybeExecute() {
  const here = parseFomoMint();
  if (!here) { console.log(LOG, "not a token page; idle"); return; }
  if (!ADDR.test(here.mint)) { console.log(LOG, "unrecognized mint; idle"); return; }

  const { pendingTrade } = await chrome.storage.local.get("pendingTrade");
  if (!pendingTrade) { console.log(LOG, "no pendingTrade; idle on", here.mint); return; }

  if (pendingTrade.mint.toLowerCase() !== here.mint.toLowerCase()) {
    console.log(LOG, "pendingTrade is for", pendingTrade.mint, "but page is", here.mint, "- waiting");
    return;
  }
  if (Date.now() - pendingTrade.ts > PENDING_MAX_AGE_MS) {
    console.warn(LOG, "pendingTrade stale (>60s); discarding", pendingTrade);
    await chrome.storage.local.remove("pendingTrade");
    return;
  }

  await chrome.storage.local.remove("pendingTrade"); // claim once
  console.log(LOG, "claimed pendingTrade", pendingTrade);

  const { fqb_dryrun = true } = await chrome.storage.local.get("fqb_dryrun");
  console.log(LOG, "dry-run =", fqb_dryrun);

  await executeTrade(pendingTrade, fqb_dryrun);
}

async function ensureMode(side) {
  if (currentMode() === side) { console.log(LOG, side, "mode already active"); return; }
  const verb = side === "sell" ? "Sell" : "Buy";
  const toggle = getToggle(verb);
  if (!toggle) throw new Error(`no ${verb} toggle found`);
  console.log(LOG, "clicking", verb, "toggle");
  toggle.click();
  await waitFor(() => (currentMode() === side ? true : null), { label: `${verb} mode`, timeout: 8000 });
  console.log(LOG, verb, "mode active");
}

// Set the amount (buy: USD preset or typed; sell: % preset) and return the ENABLED
// execute button. Retries because a preset click can silently no-op while the panel is
// still hydrating (chart/init in flight); buys fall back to typing on retry.
async function armExecuteButton(input, side, trade, verb) {
  const label = side === "buy" ? `$${trade.amountUsd}` : `${trade.percent}%`;

  // Wait for the panel to be hydrated (execute button EXISTS, even if disabled) so a
  // preset click doesn't land before React has wired it.
  await waitFor(() => getExecuteButton(verb), { label: `${verb} button present`, timeout: 8000 });

  for (let attempt = 1; attempt <= 4; attempt++) {
    const preset = getFomoPreset(label);
    if (preset) {
      console.log(LOG, `attempt ${attempt}: clicking preset ${label}`);
      preset.click();
    } else if (side === "buy") {
      // No matching fomo preset (custom amount) — typing is best-effort; fomo's input
      // may not register it, in which case the button stays disabled.
      console.log(LOG, `attempt ${attempt}: no preset ${label}; typing (best-effort)`);
      reactSetInput(input, String(trade.amountUsd));
    } else {
      throw new Error(`no sell preset "${label}" found`);
    }
    await sleep(300);
    if (tickWarningCheckboxes()) { console.log(LOG, "ticked gating warning box"); await sleep(300); }
    try {
      return await waitFor(
        () => { const b = getExecuteButton(verb); return b && !b.disabled ? b : null; },
        { label: `enabled ${verb} button`, timeout: 3000 }
      );
    } catch (_) {
      console.warn(LOG, `attempt ${attempt}: ${verb} not enabled (input="${input.value}")`);
      await sleep(400); // backoff — panel may still be settling / rate-limited
    }
  }
  throw new Error(
    `could not arm ${verb} button (input="${input.value}", preset ${label} ${getFomoPreset(label) ? "present" : "missing"}). ` +
    `If the amount is set but the button stays disabled, it's likely insufficient balance or a minimum — not a selector issue.`
  );
}

async function executeTrade(trade, dryRun) {
  const side = trade.side === "sell" ? "sell" : "buy";
  const verb = side === "sell" ? "Sell" : "Buy";
  const result = { mint: trade.mint, side, ts: Date.now(), dryRun };
  try {
    // 1. Panel ready.
    const input = await waitFor(getAmountInput, { label: "trade panel" });

    // 2. Correct mode.
    await ensureMode(side);

    if (side === "buy") result.amountUsd = trade.amountUsd; else result.percent = trade.percent;

    // 3+4. Set the amount and get the enabled execute button (with retries).
    const btn = await armExecuteButton(input, side, trade, verb);
    const label = btn.textContent.trim().replace(/\s+/g, " ");
    console.log(LOG, "input now ->", input.value, "| execute button ready:", JSON.stringify(label));

    // 5. Fire (or not).
    if (dryRun) {
      console.warn(LOG, `[DRY RUN] NOT clicking. Would click: "${label}"`);
      result.status = "dry-run";
      result.label = label;
    } else {
      btn.click();
      console.log(LOG, `CLICKED execute: "${label}" — real ${side} fired`);
      result.label = label;

      // A confirmation modal may appear after the click — tick its box + confirm.
      await sleep(400);
      if (tickWarningCheckboxes()) {
        console.log(LOG, "ticked post-click warning box; confirming");
        await sleep(250);
        clickModalConfirm();
      }
      result.status = "clicked";
    }
  } catch (err) {
    console.error(LOG, "executeTrade error:", err);
    result.status = "error";
    result.error = String(err && err.message || err);
  }
  await chrome.storage.local.set({ lastResult: result });
  console.log(LOG, "lastResult stored", result);
}

// ---- live position PnL scraping --------------------------------------------
// The position card is the smallest button containing "Invested". Its innerText is:
//   "<holdings>\n+\n$213.84\n▲\n3.24%\nInvested\n$6,608.13\nAvg entry\n$38.6M MC"
function getPositionCard() {
  const cands = [...document.querySelectorAll("button")].filter((e) => /Invested/i.test(e.textContent));
  cands.sort((a, b) => a.textContent.length - b.textContent.length);
  return cands[0] || null;
}

function parsePnl(text) {
  const usd = text.match(/([+\-])\s*\$([\d,]+(?:\.\d+)?)/);
  const pct = text.match(/([▲▼])\s*([\d,]+(?:\.\d+)?)\s*%/);
  if (!usd && !pct) return null;
  const up = (usd && usd[1] === "+") || (pct && pct[1] === "▲");
  return {
    holdings: (text.split("\n")[0] || "").trim(),
    pnlUsd: usd ? (up ? "+" : "-") + "$" + usd[2] : null,
    pnlPct: pct ? (up ? "+" : "-") + pct[2] + "%" : null,
    up,
  };
}

function scrapePnl() {
  const here = parseFomoMint();
  if (!here) return;
  const card = getPositionCard();
  const pnl = card ? parsePnl(card.innerText) : null;
  chrome.storage.local.set({
    pnl: { mint: here.mint, chain: here.chain, ...(pnl || { none: true }), ts: Date.now() },
  });
}

// Run on load + on SPA URL change; also poll PnL live.
maybeExecute();
scrapePnl();
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    console.log(LOG, "URL changed ->", lastHref);
    maybeExecute();
  }
}, 1000);
setInterval(scrapePnl, 2500);
