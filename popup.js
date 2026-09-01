// popup.js — status indicator + dry-run / focus toggles.

const $ = (id) => document.getElementById(id);

async function refresh() {
  // Is a fomo.family tab open?
  const tabs = await chrome.tabs.query({ url: ["*://fomo.family/*", "*://*.fomo.family/*"] });
  const open = tabs.length > 0;
  $("fomoDot").className = "dot " + (open ? "on" : "off");
  $("fomoState").textContent = open ? `open (${tabs.length})` : "not open";

  const { fqb_dryrun = true, fqb_focusFomo = false, lastResult } =
    await chrome.storage.local.get(["fqb_dryrun", "fqb_focusFomo", "lastResult"]);

  $("dryrun").checked = fqb_dryrun;
  $("focus").checked = fqb_focusFomo;
  $("armWarn").style.display = fqb_dryrun ? "none" : "block";

  if (lastResult) {
    const when = new Date(lastResult.ts).toLocaleTimeString();
    $("last").textContent = `${lastResult.status} $${lastResult.amountUsd} @ ${when}`;
  }
}

$("dryrun").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ fqb_dryrun: e.target.checked });
  $("armWarn").style.display = e.target.checked ? "none" : "block";
});

$("focus").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ fqb_focusFomo: e.target.checked });
});

refresh();
