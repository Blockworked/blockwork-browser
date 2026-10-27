// Store screenshots and the promo tile, into store/images/. Run after
// `node build.mjs`: `node store/shots.mjs`.
import { chromium } from "playwright";
import http from "node:http";
import { mkdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

// The popup, shown on a backdrop in both themes.
for (const scheme of ["light", "dark"]) {
  const popup = await context.newPage();
  await popup.emulateMedia({ colorScheme: scheme });
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForTimeout(500);
  await popup.addStyleTag({ content: `
    html { min-height: 100%; background: ${scheme === "dark" ? "#141517" : "#d9dee5"}; }
    body { margin: 120px auto 0; border-radius: 10px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.35); zoom: 1.4; }` });
  await popup.screenshot({ path: out + `screenshot-popup-${scheme}.png` });
  await popup.close();
}

const promo = await context.newPage();
await promo.setViewportSize({ width: 440, height: 280 });
await promo.goto(site + "/promo");
await promo.screenshot({ path: out + "promo-440x280.png" });
await promo.setViewportSize({ width: 1400, height: 560 });
await promo.screenshot({ path: out + "marquee-1400x560.png" });

await context.close();
server.close();
console.log("wrote", out);
