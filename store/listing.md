# Store listing

Text and answers for the Chrome Web Store, Edge Add-ons and Firefox Add-ons
(AMO). Images are in `images/`: `node build.mjs && node store/shots.mjs` remakes
all but `screenshot-editor.png`, which is the Blockwork editor itself.

Upload `blockwork-chrome-<version>.zip` to Chrome and Edge and
`blockwork-firefox-<version>.zip` to AMO (`node build.mjs --zip`).

## Name

Blockwork

## Summary (132 characters at most)

Lets Blockwork macros click, type and read on web pages by element, so they hit the right button even when several look the same.

## Description

Blockwork is a free desktop app for building keyboard and mouse macros out of
blocks. This extension gives its macros a direct line into your browser, so
they can work with a page by what's on it instead of by pictures of the
screen:

- Open a page, click an element, type into a field, wait for something to
  appear and read text off the page.
- Pick the right one when a page has several alike: "the Symbols button next
  to the box I'm typing in" is `focused >> near=button[title="Symbols"]`.
- Point and click to get a selector: press Pick (or right-click an element and
  choose Copy Blockwork selector) and paste it into a block.
- Run your own JavaScript in the page from a macro.

The extension talks only to the Blockwork app on your own computer, over a
local connection paired with a key from Blockwork's Settings > Integrations.
It has no servers, accounts, analytics or ads, and it does nothing on a page
until one of your macros asks it to or you use the picker.

Needs Blockwork 0.6 or newer: https://blockworked.com

## Category

Chrome: Productivity > Workflow & Planning. Edge: Productivity. AMO: Other
(or Web Development).

## Links

- Homepage: https://blockworked.com
- Support: https://github.com/Blockworked/Blockwork/issues
- Privacy policy: https://github.com/Blockworked/Blockwork/blob/master/PRIVACY.md
  (the "Browser extension" section; it's on Blockwork's `browser-store-prep`
  branch until that lands)

## Chrome Web Store: privacy practices tab

**Single purpose:** Lets the user's own Blockwork desktop macros act on web
pages: click, type into and read page elements, open pages, and copy element
selectors for use in those macros.

**Permission justifications:**

- `scripting`: Injects the selector engine and the element picker into the
  page the user's macro or the user is working with, to find, click, fill and
  read elements.
- `tabs`: Finds the active tab a macro acts on, opens a page in it or in a new
  tab, and reports its address and title back to the user's macro.
- `storage`: Keeps the pairing key and port for the connection to the local
  Blockwork app.
- `alarms`: Wakes the service worker to reconnect to the Blockwork app when it
  starts after the browser.
- `contextMenus`: Adds "Copy Blockwork selector" to the right-click menu.
- `userScripts`: Runs JavaScript the user wrote in their own macro's "Run
  JavaScript" block in the page. It only works after the user turns on Allow
  user scripts for the extension.
- Host permission `<all_urls>`: Macros act on whatever site the user automates,
  which can't be known in advance. Nothing runs on a page until the user's
  macro asks for it or the user uses the picker.

**Remote code:** No. All of the extension's code is in the package. The only
other code it runs is JavaScript the user writes in their own macro, run
through the userScripts API that Chrome provides for user-written scripts.

**Data usage:** Collects none of the listed types. Page text the user's macro
asks for goes only to the Blockwork app on the same computer, over a loopback
connection (127.0.0.1), and nothing leaves the device. Tick the three
certifications (no selling, no unrelated use, no creditworthiness).

## Firefox (AMO): notes for reviewers

> This add-on is the browser side of Blockwork, an open-source desktop macro
> app (https://github.com/Blockworked/Blockwork). It connects only to
> ws://127.0.0.1:<port> (default 8788) and proves both ends know a pairing key
> with HMAC-SHA256 before accepting any request.
>
> To try it without the desktop app: nothing visible happens beyond the
> toolbar popup (status, Pick an element, Pairing) and the right-click "Copy
> Blockwork selector" item, both of which work on any page.
>
> userScripts: used only for the "Run JavaScript" block, where the user writes
> the script in their own macro. Following the user scripts policy, each
> script must be allowed by the user in a window that shows its code before
> it ever runs (src/approve/), a changed script asks again, and the allowed
> scripts are listed in the toolbar popup with a Remove button. The
> permission is optional and requested from that window's Allow button.
>
> The package is not minified or bundled: build.mjs only copies src/ and
> writes manifest.json and target.js, so the files are the source.

Data collection: the manifest declares `data_collection_permissions: none`.

## Before submitting

- Release Blockwork with the browser blocks first, or the listing points at
  something nobody can use yet.
- Bump `version` in `manifest.base.json` for every upload.
- Chrome's review for `<all_urls>` is a manual one and can take a week or more.
