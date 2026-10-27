// Loads dist/chrome into Chromium, pairs it with a fake Blockwork and drives
// the fixture page through it. `node build.mjs && node test/extension.test.mjs`
import { chromium } from "playwright";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeBlockwork } from "./fake-blockwork.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ext = here("../dist/chrome");
const key = "test-key-123";

// Pages come from http, since extensions need permission for file:// URLs.
const page = http.createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(readFileSync(here("fixture.html"))));
await new Promise((r) => page.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${page.address().port}/`;

const blockwork = fakeBlockwork({ key });
const port = await blockwork.listen();

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "bw-ext-")), {
  headless: !process.env.HEADED,
  channel: "chromium",
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent("serviceworker");

const tab = await context.newPage();
await tab.goto(site);
await tab.bringToFront();

// Pair it the way the popup does.
await worker.evaluate(async ([port, key]) => {
  await chrome.storage.local.set({ port, key });
}, [port, key]);
await worker.evaluate(() => connect());
const until = async (test, what) => {
  const end = Date.now() + 10000;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
await until(() => blockwork.connected() === 1, "the extension pairs");

const log = () => tab.evaluate(() => window.log.splice(0));

const info = await blockwork.request("info");
assert.equal(info.url, site);

// The screenshot's case, as a "when I type sqrt" macro would run it.
await tab.focus("[aria-label='second answer']");
await blockwork.request("click", { selector: "focused >> near=button", nth: 1 });
await blockwork.request("click", { selector: "text=square root", nth: 1 });
assert.deepEqual(await log(), ["palette:second answer", "sqrt"]);

await blockwork.request("type", { selector: "[aria-label='first answer']", nth: 1, text: "x^2" });
assert.deepEqual(await log(), ["input:x^2"]);
assert.equal((await blockwork.request("read", { selector: ".math", wait: 0 })).value, "x^2");
assert.equal((await blockwork.request("count", { selector: "button.palette" })).count, 2);
await assert.rejects(blockwork.request("click", { selector: "text=nowhere", wait: 300 }), /nothing on the page matches text=nowhere/);
await assert.rejects(blockwork.request("click", { selector: "button.palette", nth: 5, wait: 300 }), /only 2 elements match/);
// Run JavaScript needs the user's "Allow user scripts" switch.
await assert.rejects(blockwork.request("script", { code: "1 + 1" }), /Allow user scripts/);
const settings = await context.newPage();
await settings.goto(`chrome://extensions/?id=${new URL(worker.url()).host}`);
await settings.click("#allow-user-scripts");
await settings.close();
await tab.bringToFront();
await until(() => worker.evaluate(() => typeof chrome.userScripts?.execute === "function"), "user scripts are allowed");
assert.equal((await blockwork.request("script", { code: "document.querySelectorAll('button').length" })).value, "7");
await assert.rejects(blockwork.request("script", { code: "throw new Error('nope')" }), /nope/);
await assert.rejects(blockwork.request("script", { code: "let = = 1" }), /.+/);
assert.equal((await blockwork.request("script", { code: "window.log.length >= 0" })).value, "true");
assert.equal((await blockwork.request("script", { code: "const a = 2; return a * 21" })).value, "42");

// Waits for an element that shows up late.
await tab.evaluate(() => setTimeout(() => document.body.insertAdjacentHTML("beforeend", "<button id=late>Late</button>"), 600));
await blockwork.request("click", { selector: "#late" });

// Blockwork can ask for a pick: the next click on the page answers it.
const picking = blockwork.request("pick");
await tab.waitForFunction(() => globalThis.document.querySelector("div[style*='2147483647']"));
await tab.mouse.move(1, 1);
const box = await tab.locator("[aria-label='second answer'] + button").boundingBox();
await tab.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
assert.equal((await picking).selector, 'input[aria-label="second answer"] >> near=button[title="Symbols"]');
assert.deepEqual(await log(), [], "the picking click doesn't reach the page");

// The popup shows useful tools after pairing and preserves a saved key.
const popup = await context.newPage();
await tab.bringToFront();
const extensionId = new URL(worker.url()).host;
await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
await popup.waitForFunction(() => document.getElementById("state").textContent === "Connected");
assert.equal(await popup.locator("#pairing").getAttribute("open"), null);
assert.equal(await popup.locator("#save").textContent(), "Save changes");
assert.equal(await popup.locator("#save").isDisabled(), true);
await popup.locator("#pairing summary").click();
await popup.locator("#port").fill(String(port + 1));
assert.equal(await popup.locator("#save").isDisabled(), false);
await popup.locator("#port").fill(String(port));
assert.equal(await popup.locator("#save").isDisabled(), true);
await popup.locator("#pairing summary").click();
assert.equal(await popup.locator("#last-selector").textContent(), 'input[aria-label="second answer"] >> near=button[title="Symbols"]');
await popup.locator("#selector").fill("button.palette");
await popup.locator("#check").click();
await popup.waitForFunction(() => document.getElementById("matches").textContent === "2 matches on this page.");
await popup.locator("#selector").fill(".no-such-element");
await popup.locator("#check").click();
await popup.waitForFunction(() => document.getElementById("matches").textContent === "No matches on this page.");
await popup.locator("#selector").fill("[");
await popup.locator("#check").click();
await popup.waitForFunction(() => !document.getElementById("check").disabled);
assert.match(await popup.locator("#matches").textContent(), /invalid|selector|syntax/i);

const save = (port, key = "") => popup.evaluate(([port, key]) => chrome.runtime.sendMessage({ type: "saveSettings", port, key }), [port, key]);
assert.ok((await save(0)).error, "invalid ports are rejected");
assert.equal((await save(port)).ok, true);
await until(() => blockwork.connected() === 1, "reconnect with the saved key");
assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("key")).key), key);

// A browser-owned page explains why tools are unavailable.
await popup.bringToFront();
await popup.reload();
await popup.waitForFunction(() => document.getElementById("page-hint").textContent.includes("Open a web page"));
assert.equal(await popup.locator("#pick").isDisabled(), true);
assert.equal(await popup.locator("#check").isDisabled(), true);
await popup.close();
await tab.bringToFront();

await blockwork.request("open", { url: site + "?second", newTab: true });
assert.equal((await blockwork.request("info")).url, site + "?second");

// A key that doesn't match is refused, and the extension says so.
const stranger = fakeBlockwork({ key: "other" });
const strangerPort = await stranger.listen();
await worker.evaluate(async ([port]) => {
  await chrome.storage.local.set({ port });
  socket?.close();
  socket = null;
  await connect();
}, [strangerPort]);
await until(() => worker.evaluate(() => status.state === "denied"), "a wrong key is refused");
assert.equal(stranger.connected(), 0);

await context.close();
await blockwork.close();
await stranger.close();
page.close();
console.log("extension: all passed");
