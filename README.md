# Fomo QuickBuy

A Chrome MV3 extension that overlays a floating quick-buy widget on **gmgn.ai** Solana
token pages. Clicking Buy drives your already-open **fomo.family** tab to execute the
trade — no tab switching, no reimplementing Privy signing.

## How it works

```
gmgn.ai/sol/token/<mint>          fomo.family/tokens/solana/<mint>
   [widget: amount + Buy]                 [content-fomo executor]
            │                                      ▲
            └── FOMO_BUY msg ──► background.js ─────┘
                                 (stores pendingBuy,
                                  navigates fomo tab)
```

1. `content-gmgn.js` detects the mint from the gmgn URL and injects the widget.
2. On Buy it sends `FOMO_BUY` to `background.js`.
3. Background writes `pendingBuy` to `chrome.storage.local`, then navigates (or opens)
   the fomo tab to `fomo.family/tokens/solana/<mint>`.
4. `content-fomo.js` loads there, sees `pendingBuy` matches the page, switches the panel
   to **Buy**, types the USD amount (React-safe), and clicks **Buy \<TOKEN\>**.

Amounts are **USD** — fomo's buy input is USD-denominated ($500 = N tokens), so no
SOL→USD conversion is needed.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. **Load unpacked** → select this folder (`fomo-quickbuy`).
4. Pin the extension if you like (puzzle-piece menu).

## Use

1. Open **fomo.family** in a tab and make sure you're logged in.
2. Open any **gmgn.ai Solana** token page: `https://gmgn.ai/sol/token/<mint>`.
3. The widget appears (top-right, draggable, collapsible — position is remembered).
4. Pick a preset or type a USD amount → **Buy**.

### Dry run (default: ON)

The extension ships with **Dry run ON** — it does everything except the final click, so
you can verify the whole pipeline safely. Toggle it in the popup:

- Click the extension icon → uncheck **Dry run** to fire real buys.
- ⚠️ With dry run OFF, **a click is a real, instant, irreversible buy** — fomo has no
  confirmation step.

The popup also shows whether a fomo tab is open and the result of the last buy.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest, permissions, content-script matches |
| `content-gmgn.js` | Mint detector + floating widget (Shadow DOM) |
| `content-fomo.js` | Executor: fills amount + clicks Buy on fomo |
| `background.js` | Message router; stores pendingBuy, drives the fomo tab |
| `popup.html` / `popup.js` | Status + dry-run / focus toggles |

## MV3 gotchas handled

- **Ephemeral service worker.** `background.js` keeps no durable in-memory state; every
  buy is handed off via `chrome.storage.local` (`pendingBuy`), so it survives the worker
  being killed and respawned.
- **React controlled input.** Setting `input.value` directly is ignored by React;
  `content-fomo.js` uses the native value setter + a real `input` event.
- **Navigation vs. messaging race.** Instead of messaging the fomo tab (which reloads on
  navigation), background stores `pendingBuy` and lets the freshly-loaded content script
  claim it. `pendingBuy` is claimed-once and expires after 60s.
- **Shadow DOM isolation.** The widget lives in a shadow root appended to `<html>`, so
  gmgn's CSS can't leak in and gmgn re-rendering `<body>` won't remove it.

## Scope

Chains: **Solana + EVM** (BSC, Ethereum, Base). **Buy** (USD presets, editable via ✎) and
**Sell** (% presets). **Live position uPnL** streamed from the fomo tab. The widget stays
hidden on gmgn chains not in the map below.

gmgn → fomo chain slugs (`GMGN_TO_FOMO`, defined in both content-gmgn.js and background.js):
`sol→solana`, `bsc→bnb`, `eth→ethereum`, `base→base`. Add a chain by adding one entry to
both maps (fomo also has a `robinhood` chain; add it if gmgn exposes a matching slug).

Messages: `FOMO_TRADE { mint, chain, side, amountUsd|percent }` (execute) and
`FOMO_TRACK { mint, chain }` (point fomo tab at a token for live PnL). Addresses are Solana
base58 or EVM `0x…` (40 hex); the fomo executor matches the pending trade by mint
case-insensitively.

### Unverified-token warning

Some tokens gate the trade behind an "are you sure / I understand" checkbox — either
inline (the Buy/Sell button stays disabled until ticked) or as a modal after the click.
The executor auto-ticks it: `tickWarningCheckboxes()` clicks any visible unchecked
checkbox that's inside a dialog/modal or sits next to warning-type text (matched by
`WARN_RE`), and `clickModalConfirm()` clicks the modal's confirm button. It runs both
before the execute click (gating case) and after (modal case). Heuristic — if fomo uses
wording outside `WARN_RE`, add it there.

## Selectors (fomo)

Derived from the live DOM — update here if fomo redeploys and something breaks:

- Amount input: `input[placeholder="0"]` (holds token qty in Sell mode)
- Buy/Sell toggle: `button` (type=button) with exact text `Buy` / `Sell`
- Presets: `button.hover-scrim` whose text is `$100` (buy) or `50%` (sell)
- Execute button: any button whose text is `Buy <TOKEN>`/`Sell <TOKEN>` (match by text, not
  `type` attribute — fomo omits it); mode detected by which preset type ($ vs %) is showing
- Risk-warning checkbox: a row with two sibling `<button>`s — the orange square SVG
  (`style="color: rgb(255,98,46)"`) is the checkbox; the other is an accordion toggle. Tick the
  square (`findRiskCheckbox`), not the accordion, or you just collapse the warning
