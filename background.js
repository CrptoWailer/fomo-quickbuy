// background.js — message router between the gmgn widget and the fomo executor.
//
// MV3 note: this service worker is EPHEMERAL. Chrome kills it after ~30s idle and
// respawns it on the next event. So we keep ZERO durable state in memory here —
// every trade is handed off via chrome.storage.local ("pendingTrade"), which the fomo
// content script picks up after it (re)loads.

const LOG = "[FQB/bg]";
const GMGN_TO_FOMO = { sol: "solana", bsc: "bnb", eth: "ethereum", base: "base", robinhood: "robinhood" };
const ADDR = /^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})$/;

function fomoUrl(gmgnChain, mint) {
  const slug = GMGN_TO_FOMO[gmgnChain];
  if (!slug) throw new Error(`unsupported chain: ${gmgnChain}`);
  return `https://fomo.family/tokens/${slug}/${mint}`;
}

console.log(LOG, "service worker booted");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log(LOG, "onMessage", msg && msg.type, "from tab", sender.tab && sender.tab.id);

  if (msg && msg.type === "FOMO_TRADE") {
    handleTrade(msg)
      .then((res) => sendResponse(res))
      .catch((err) => { console.error(LOG, "handleTrade failed", err); sendResponse({ ok: false, error: String(err && err.message || err) }); });
    return true;
  }

  if (msg && msg.type === "FOMO_TRACK") {
    trackToken(msg.mint, msg.chain)
      .then((res) => sendResponse(res))
      .catch((err) => { console.error(LOG, "trackToken failed", err); sendResponse({ ok: false, error: String(err && err.message || err) }); });
    return true;
  }
});

// Point the fomo tab at a token so its content script can scrape live PnL. Only
// navigates if the tab isn't already on that token (avoids reload loops).
async function trackToken(mint, chain) {
  if (!ADDR.test(mint)) throw new Error(`bad mint: ${mint}`);
  const targetUrl = fomoUrl(chain, mint);
  const tabs = await chrome.tabs.query({ url: ["*://fomo.family/*", "*://*.fomo.family/*"] });
  if (!tabs.length) return { ok: false, error: "no fomo tab open" };
  const tab = tabs[0];
  if (tab.url && tab.url.toLowerCase().includes(mint.toLowerCase())) return { ok: true, already: true };
  console.log(LOG, "tracking: navigating fomo tab to", targetUrl);
  await chrome.tabs.update(tab.id, { url: targetUrl, active: false });
  return { ok: true, navigated: true };
}

async function handleTrade(msg) {
  const mint = String(msg.mint || "").trim();
  const chain = String(msg.chain || "sol");
  if (!ADDR.test(mint)) throw new Error(`bad mint: ${mint}`);
  const targetUrl = fomoUrl(chain, mint); // throws if chain unsupported

  const side = msg.side === "sell" ? "sell" : "buy";
  const pendingTrade = { mint, side, chain, ts: Date.now() };

  if (side === "buy") {
    const amountUsd = Number(msg.amountUsd);
    if (!(amountUsd > 0)) throw new Error(`bad amount: ${msg.amountUsd}`);
    pendingTrade.amountUsd = amountUsd;
  } else {
    const percent = Number(msg.percent);
    if (!(percent > 0 && percent <= 100)) throw new Error(`bad percent: ${msg.percent}`);
    pendingTrade.percent = percent;
  }

  await chrome.storage.local.set({ pendingTrade });
  console.log(LOG, "pendingTrade stored", pendingTrade);

  const { fqb_focusFomo = false } = await chrome.storage.local.get("fqb_focusFomo");

  const tabs = await chrome.tabs.query({ url: ["*://fomo.family/*", "*://*.fomo.family/*"] });
  console.log(LOG, "found", tabs.length, "fomo tab(s)");

  let tabId;
  if (tabs.length > 0) {
    tabId = tabs[0].id;
    console.log(LOG, "navigating existing fomo tab", tabId, "->", targetUrl);
    await chrome.tabs.update(tabId, { url: targetUrl, active: fqb_focusFomo });
  } else {
    console.log(LOG, "no fomo tab open; creating one ->", targetUrl);
    const tab = await chrome.tabs.create({ url: targetUrl, active: fqb_focusFomo });
    tabId = tab.id;
  }

  return { ok: true, tabId, targetUrl, hadTab: tabs.length > 0, side };
}
