// Store screenshots and the promo tile, into store/images/. Run after
// `node build.mjs`: `node store/shots.mjs`.
import { chromium } from "playwright";
import http from "node:http";
import { mkdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeBlockwork } from "../test/fake-blockwork.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ext = here("../dist/chrome");
const out = here("images/");
mkdirSync(out, { recursive: true });

const files = { "/": "demo.html", "/promo": "promo.html" };
const server = http.createServer((req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(here(files[req.url] || "demo.html"))));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "bw-store-")), {
  headless: true,
  channel: "chromium",
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent("serviceworker");
const id = new URL(worker.url()).host;

// The element picker over a page with two identical symbol buttons.
const page = await context.newPage();
await page.goto(site);
await page.bringToFront();
await page.focus("[aria-label='second answer']");
await worker.evaluate(async () => startPicker(await activeTab()));
const button = page.locator(".palette").nth(1);
const box = await button.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(300);
await page.screenshot({ path: out + "screenshot-picker.png" });

// The toolbar popup open over the same page: paired, with the picked
// selector checked. The popup is drawn as an image where the browser puts it.
const blockwork = fakeBlockwork({ key: "store-key" });
const port = await blockwork.listen();
await worker.evaluate(async ([port, key]) => chrome.storage.local.set({ port, key }), [port, "store-key"]);
await worker.evaluate(() => connect());
await page.keyboard.press("Escape");
const selector = 'input[aria-label="second answer"] >> near=button[title="Symbols"]';
await worker.evaluate(async ([selector, url]) => chrome.storage.local.set({ lastPicked: { selector, url } }), [selector, page.url()]);
const tabId = await worker.evaluate(async () => (await activeTab()).id);
for (const scheme of ["light", "dark"]) {
  const popup = await context.newPage();
  await popup.emulateMedia({ colorScheme: scheme });
  await popup.setViewportSize({ width: 400, height: 700 });
  // The popup reads "the current tab"; point that at the demo page.
  await popup.addInitScript((tabId) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (q) => (q.active ? [await chrome.tabs.get(tabId)] : query(q));
  }, tabId);
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(() => document.getElementById("state").textContent === "Connected");
  await popup.click("#check");
  await popup.waitForFunction(() => /match/.test(document.getElementById("matches").textContent));
  const box = await popup.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });
  const shot = await popup.screenshot({ clip: { x: 0, y: 0, ...box } });
  await popup.close();

  await page.bringToFront();
  await page.emulateMedia({ colorScheme: scheme });
  await page.evaluate(([src, width]) => {
    document.getElementById("store-popup")?.remove();
    const img = document.createElement("img");
    img.id = "store-popup";
    img.src = src;
    img.style.cssText = `position:fixed;top:8px;right:16px;width:${width}px;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.35);z-index:2147483647`;
    document.body.append(img);
    return new Promise((r) => (img.complete ? r() : (img.onload = r)));
  }, ["data:image/png;base64," + shot.toString("base64"), box.width]);
  await page.mouse.move(0, 799);
  await page.screenshot({ path: out + `screenshot-popup-${scheme}.png` });
}
await blockwork.close();

const promo = await context.newPage();
await promo.setViewportSize({ width: 440, height: 280 });
await promo.goto(site + "/promo");
await promo.screenshot({ path: out + "promo-440x280.png" });
await promo.setViewportSize({ width: 1400, height: 560 });
await promo.screenshot({ path: out + "marquee-1400x560.png" });

await context.close();
server.close();
console.log("wrote", out);
