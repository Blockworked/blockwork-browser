# Blockwork browser extension

Lets [Blockwork](https://github.com/Blockworked/Blockwork) macros act on web
pages directly: click, type into and read elements by what they are, instead
of finding them as pictures on screen. Works in Chrome, Edge and other
Chromium browsers and Firefox 153+, both Manifest V3.

## Install

```bash
node build.mjs          # dist/chrome and dist/firefox
node build.mjs --zip    # also blockwork-chrome-<version>.zip and blockwork-firefox-<version>.zip
```

- **Chrome / Edge:** open `chrome://extensions`, turn on Developer mode, Load
  unpacked, pick `dist/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, Load Temporary
  Add-on, pick `dist/firefox/manifest.json` (until it's signed on AMO).

## Pair it with Blockwork

1. In Blockwork, Settings > Integrations, turn on **Browser extension** and
   copy the pairing key.
2. Click the Blockwork button in the browser's toolbar, open **Pairing**, paste
   the key and press Connect. The dot turns green.

The extension connects to `ws://127.0.0.1:8788` (the port is in both places).
It reconnects by itself when Blockwork starts later.

## Blocks

In Blockwork's **Browser** category:

| Block | Does |
| --- | --- |
| open [url] in this tab / a new tab | Navigates and waits for the page to load |
| click element [selector] (+ which match) | Clicks it, waiting up to 5 s for it to show up |
| type [text] into element [selector] (+ which match) | Fills a field the way typing would (inputs, rich text, `<select>`) |
| wait until element [selector] appears / disappears | Polls until it does, with a time limit |
| set [var] to result of JavaScript [code] | Runs in the page; `document.title` or statements with `return`. See below |
| page address, page title, text of element, element exists?, number of elements matching, browser connected? | Reporters |

Requests go to the active tab of the browser window focused most recently.

### Run JavaScript

Scripts run through the browser's `userScripts` API, the one the stores allow
for code the user writes, in the page's own world.

- **Chrome / Edge:** turn on **Allow user scripts** on the extension's Details
  page in `chrome://extensions` (Chrome 135+).
- **Firefox:** the first time a macro runs a script, a window shows the code
  with Allow and Deny (and Firefox asks for the user-scripts permission once).
  Allowed scripts run without asking again and are listed in the toolbar menu,
  where they can be removed. A changed script counts as new. This is what
  AMO's policy asks of `userScripts`.

## Selectors

A selector is one or more parts joined by `>>`; each part searches inside what
the part before it matched.

| Part | Matches |
| --- | --- |
| `button.save` or `css=button.save` | CSS, through open shadow roots |
| `text=Square root` | Shown elements reading that (any case), or its aria-label, title, alt or placeholder; if none do, ones containing it |
| `text="Square root"` | Exactly that text |
| `xpath=//button[2]` | XPath |
| `nth=2` | Only the 2nd match so far (`-1` is the last) |
| `focused` | The element with the keyboard |
| `closest=.card` | The nearest enclosing `.card` of each match so far |
| `near=button` | Buttons in the closest enclosing element that has any, nearest first |

Two identical buttons, one beside each answer box, and you want the one
beside the box you're typing in: `focused >> near=button`.

The extension writes selectors for you: press **Pick an element** in its
popup, or right-click an element and choose **Copy Blockwork selector**. Either
copies a selector that matches only that element, like
`input[aria-label="second answer"] >> near=button[title="Symbols"]`.

## How it talks to Blockwork

Blockwork's bridge (`blockwork-core/src/browser.rs`) is a WebSocket server on
127.0.0.1 that only accepts extension origins. Before anything else both sides
prove they know the pairing key: each answers the other's random nonce with
HMAC-SHA256(key, `"client:"` or `"server:"` + nonce). So a web page can't pose
as the extension, and another program on the port can't drive the browser.

Then Blockwork sends `{"type":"request","id","cmd","args"}` and the extension
answers `{"type":"response","id","ok","result"|"error"}`. Commands: `info`,
`open`, `count`, `click`, `type`, `read`, `script`, `pick`. The extension also
sends `{"type":"focus","focused"}` when a browser window gains focus, and pings
every 20 s.

| File | |
| --- | --- |
| `src/engine.js` | Selector engine and page actions; a content script in every frame |
| `src/background.js` | Connection, handshake, commands, context menu |
| `src/picker.js` | The point-and-click picker |
| `src/protocol.js` | HMAC helpers for the handshake |
| `src/popup/` | Status, pairing, the Pick button and (Firefox) allowed scripts |
| `src/approve/` | The window that asks to allow a script (Firefox) |
| `store/` | Store listing text, reviewer notes and images (`node store/shots.mjs`) |

## Tests

```bash
npm install             # Playwright
npm test                # engine, the built extension against a stand-in Blockwork, script approvals
```
