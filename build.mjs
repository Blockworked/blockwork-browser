// Builds dist/chrome (Manifest V3, service worker) and dist/firefox
// (Manifest V2 with a persistent background page, which keeps the socket to
// Blockwork open). `node build.mjs [--zip]`.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const base = JSON.parse(readFileSync("manifest.base.json", "utf8"));
const permissions = ["scripting", "tabs", "storage", "alarms", "contextMenus"];

const targets = {
  chrome: {
    ...base,
    manifest_version: 3,
    minimum_chrome_version: "116",
    permissions,
    host_permissions: ["<all_urls>"],
    background: { service_worker: "background.js" },
    action: { default_popup: "popup/popup.html", default_icon: base.icons, default_title: "Blockwork" },
  },
  firefox: {
    ...base,
    manifest_version: 2,
    permissions: [...permissions, "<all_urls>"],
    background: { scripts: ["protocol.js", "background.js"], persistent: true },
    browser_action: { default_popup: "popup/popup.html", default_icon: base.icons, default_title: "Blockwork" },
    browser_specific_settings: { gecko: { id: "browser@blockworked.com", strict_min_version: "128.0" } },
  },
};

rmSync("dist", { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const out = `dist/${name}`;
  mkdirSync(out, { recursive: true });
  cpSync("src", out, { recursive: true });
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  if (process.argv.includes("--zip")) {
    execFileSync("zip", ["-qr", `../blockwork-${name}-${base.version}.zip`, "."], { cwd: out });
  }
}
console.log("built", Object.keys(targets).map((t) => `dist/${t}`).join(", "));
