// Runs engine.js in Chromium against fixture.html. `node test/engine.test.mjs`
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + here("fixture.html"));
await page.addScriptTag({ path: here("../src/engine.js") });

const run = (op, args) => page.evaluate(([op, args]) => BlockworkEngine.run(op, args), [op, args]);
const count = async (selector) => (await run("count", { selector })).count;
const log = () => page.evaluate(() => window.log.splice(0));

// The screenshot's case: two identical symbol buttons, the wanted one beside
// the field being typed in.
assert.equal(await count("button.palette"), 2);
await page.focus("[aria-label='second answer']");
assert.equal(await count("focused >> near=button"), 1);
assert.deepEqual(await run("click", { selector: "focused >> near=button" }), { done: "<button> ∫π∑∂" });
assert.deepEqual(await log(), ["palette:second answer"]);
await page.focus("[aria-label='first answer']");
await run("click", { selector: "focused >> closest=.answer >> button" });
assert.deepEqual(await log(), ["palette:first answer"]);
await run("click", { selector: "button.palette", nth: 2 });
assert.deepEqual(await log(), ["palette:second answer"]);
await run("click", { selector: "button.palette >> nth=-1" });
assert.deepEqual(await log(), ["palette:second answer"]);

// Text matches the label too, and only what's shown.
await run("click", { selector: "text=square root" });
assert.deepEqual(await log(), ["sqrt"]);
assert.equal(await count("text=More"), 3, "the wrapper button, not its span, and both keypads");
await run("click", { selector: ".keypad >> nth=2 >> text=more" });
assert.deepEqual(await log(), ["more2"]);
assert.equal(await count('text="more"'), 0, "quoted text is exact");
assert.equal(await count("text=save"), 1, "contains, when nothing reads exactly that");
assert.equal(await count("xpath=//div[@class='keypad']/button"), 2);
assert.equal(await count("text=Shadow button"), 1);
await run("click", { selector: "button.inner" });
assert.deepEqual(await log(), ["shadow"]);
assert.deepEqual(await run("click", { selector: "button.palette", nth: 3 }), { missing: true, count: 2 });

// Typing and reading.
await run("type", { selector: "[aria-label='first answer']", text: "sqrt(2)" });
assert.deepEqual(await log(), ["input:sqrt(2)"]);
assert.equal((await run("read", { selector: ".math" })).value, "sqrt(2)");
await run("type", { selector: "#editor", text: "hello" });
assert.equal((await run("read", { selector: "#editor" })).value, "hello");
await run("type", { selector: "#pick", text: "Banana" });
assert.equal((await run("read", { selector: "#pick" })).value, "b");
assert.equal((await run("read", { selector: "[data-testid=save]", what: "data-testid" })).value, "save");
await assert.rejects(run("type", { selector: ".keypad" , text: "x" }), /isn't a text field/);

// The picker's selectors are unique and find their element again.
const picked = await page.evaluate(() =>
  [...document.querySelectorAll("button, input, select, [contenteditable]")]
    .filter((el) => el.getClientRects().length)
    .map((el) => {
      const selector = BlockworkEngine.selectorFor(el);
      const found = BlockworkEngine.findAll(selector);
      return { selector, ok: found.length === 1 && found[0] === el };
    }),
);
for (const p of picked) assert.ok(p.ok, `${p.selector} isn't unique`);
console.log(picked.map((p) => p.selector).join("\n"));

await browser.close();
console.log("engine: all passed");
