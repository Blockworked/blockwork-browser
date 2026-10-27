// Builds dist/chrome (Manifest V3, service worker) and dist/firefox
// (Manifest V3, event page). `node build.mjs [--zip]`.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const base = JSON.parse(readFileSync("manifest.base.json", "utf8"));
const permissions = ["scripting", "tabs", "storage", "alarms", "contextMenus"];

// What background.js and the popup need to know about the build.
const flags = {
  chrome: { browser: "chrome", approveScripts: false },
  firefox: { browser: "firefox", approveScripts: true },
};

const targets = {
  chrome: {
    ...base,
    manifest_version: 3,
    minimum_chrome_version: "116",
    permissions: [...permissions, "userScripts"],
    host_permissions: ["<all_urls>"],
    background: { service_worker: "background.js" },
    action: { default_popup: "popup/popup.html", default_icon: base.icons, default_title: "Blockwork" },
  },
  // Manifest V3 for userScripts.execute (Firefox 153), with an event page.
  firefox: {
    ...base,
    manifest_version: 3,
    permissions,
    host_permissions: ["<all_urls>"],
    optional_permissions: ["userScripts"],
    background: { scripts: ["protocol.js", "target.js", "background.js"] },
    action: { default_popup: "popup/popup.html", default_icon: base.icons, default_title: "Blockwork" },
    browser_specific_settings: {
      gecko: { id: "browser@blockworked.com", strict_min_version: "153.0", data_collection_permissions: { required: ["none"] } },
    },
  },
};

rmSync("dist", { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const out = `dist/${name}`;
  mkdirSync(out, { recursive: true });
  cpSync("src", out, { recursive: true });
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(`${out}/target.js`, `globalThis.BlockworkTarget = ${JSON.stringify(flags[name])};\n`);
  if (process.argv.includes("--zip")) {
    execFileSync("zip", ["-qr", `../blockwork-${name}-${base.version}.zip`, "."], { cwd: out });
  }
}
console.log("built", Object.keys(targets).map((t) => `dist/${t}`).join(", "));
