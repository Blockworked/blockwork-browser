// The approval flow the Firefox build uses for Run JavaScript, run in
// Chromium on a copy of dist/chrome with approvals switched on.
// `node build.mjs && node test/approve.test.mjs`
import { chromium } from "playwright";
import assert from "node:assert/strict";
import http from "node:http";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeBlockwork } from "./fake-blockwork.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ext = here("../dist/chrome-approve");
rmSync(ext, { recursive: true, force: true });
cpSync(here("../dist/chrome"), ext, { recursive: true });
writeFileSync(join(ext, "target.js"), 'globalThis.BlockworkTarget = {"browser":"chrome","approveScripts":true};\n');

const page = http.createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end("<title>t</title><p>hi</p>"));
await new Promise((r) => page.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${page.address().port}/`;

const key = "approve-key";
const blockwork = fakeBlockwork({ key });
const port = await blockwork.listen();

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "bw-approve-")), {
  headless: !process.env.HEADED,
  channel: "chromium",
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent("serviceworker");
const id = new URL(worker.url()).host;

const settings = await context.newPage();
await settings.goto(`chrome://extensions/?id=${id}`);
await settings.click("#allow-user-scripts");
await settings.close();

const tab = await context.newPage();
await tab.goto(site);
await tab.bringToFront();

const until = async (test, what) => {
  const end = Date.now() + 10000;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
await until(() => worker.evaluate(() => typeof chrome.userScripts?.execute === "function"), "user scripts are allowed");
await worker.evaluate(async ([port, key]) => chrome.storage.local.set({ port, key }), [port, key]);
await worker.evaluate(() => connect());
await until(() => blockwork.connected() === 1, "the extension pairs");

const approval = () => context.waitForEvent("page", { predicate: (p) => p.url().includes("/approve/approve.html") });

// A new script waits for Allow, then runs.
let asking = approval();
let running = blockwork.request("script", { code: "document.title + '!'" });
let window = await asking;
await window.waitForSelector("#code:not(:empty)");
assert.equal(await window.textContent("#code"), "document.title + '!'");
assert.equal(await window.textContent("#site"), new URL(site).host);
await window.click("#allow");
assert.equal((await running).value, "t!");

// The same script runs straight away now.
assert.equal((await blockwork.request("script", { code: "document.title + '!'" })).value, "t!");

// Deny and closing the window both refuse.
asking = approval();
running = blockwork.request("script", { code: "1 + 1" });
running.catch(() => {});
window = await asking;
await window.click("#deny");
await assert.rejects(running, /denied/);

asking = approval();
running = blockwork.request("script", { code: "2 + 2" });
running.catch(() => {});
window = await asking;
await window.close();
await assert.rejects(running, /denied/);

// The popup lists the allowed script and removes it.
const popup = await context.newPage();
await popup.goto(`chrome-extension://${id}/popup/popup.html`);
await popup.waitForSelector("#scripts li");
assert.equal(await popup.textContent("#scripts code"), "document.title + '!'");
await popup.click("#scripts button");
await popup.waitForSelector("#scriptsNone:not([hidden])");
assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get("scripts")).scripts), []);

await context.close();
blockwork.close?.();
page.close();
rmSync(ext, { recursive: true, force: true });
console.log("approve: all passed");
process.exit(0);
