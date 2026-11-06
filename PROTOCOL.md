# Blockwork bridge protocol (version 1)

How Blockwork and this extension talk. The two halves are
`blockwork-core/src/browser.rs` in Blockwork and `src/background.js` here, and
`test/fake-blockwork.mjs` plays Blockwork's side in the tests. Change all
three together, and bump `PROTOCOL` on both sides (`browser.rs` and
`src/protocol.js`) when a message changes shape.

Every message is one JSON object in a WebSocket text frame. Blockwork listens
on `ws://127.0.0.1:<port>/blockwork` (port 8788 unless changed in Settings >
Integrations) and accepts only `chrome-extension://` and `moz-extension://`
origins. A message is at most 16 MiB.

## Handshake

Both sides prove they hold the pairing key before anything else. `mac` is
HMAC-SHA256 of the key over the text given, in lowercase hex.

| From | Message |
| --- | --- |
| Blockwork | `{"type":"hello","nonce","protocol":1,"version"}` |
| Extension | `{"type":"auth","protocol":1,"nonce","mac":HMAC("client:"+hello.nonce),"browser","extension"}` |
| Blockwork | `{"type":"welcome","mac":HMAC("server:"+auth.nonce),"version"}`, or `{"type":"denied","reason"}` and the socket closes |

The extension drops the connection if `welcome.mac` doesn't match its own
nonce. Blockwork gives the handshake 10 seconds.

## After the handshake

| From | Message |
| --- | --- |
| Blockwork | `{"type":"request","id","cmd","args"}` |
| Extension | `{"type":"response","id","ok":true,"result"}` or `{"type":"response","id","ok":false,"error"}` |
| Extension | `{"type":"focus","focused"}` when a browser window gains or loses focus |
| Extension | `{"type":"ping"}` every 20 seconds; Blockwork drops a peer silent for a minute |

`error` is a sentence for the run log, such as "nothing on the page matches
#login".

## Commands

`selector` is a Blockwork selector (see the README), and `nth` counts matches
from 1. `wait` is how long to keep looking, in milliseconds.

| `cmd` | `args` | `result` |
| --- | --- | --- |
| `info` | none | `{url, title, browser}` of the active tab |
| `open` | `url`, `newTab`, `wait` | `{url}` once the page has loaded |
| `count` | `selector`, `tabId` | `{count}` across every frame |
| `click` | `selector`, `nth`, `button`, `wait` | `{done}`, a short description of the element |
| `type` | `selector`, `nth`, `text`, `append`, `wait` | `{done}` |
| `read` | `selector`, `nth`, `what`, `wait` | `{value}` |
| `script` | `code` | `{value}` of the expression, or of the function body's `return` |
| `pick` | `wait` | `{selector}` the user picked on the page |

A command this version doesn't know answers "this version of the extension
can't <cmd>; update it".
