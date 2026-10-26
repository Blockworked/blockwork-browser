// Keeps a connection to Blockwork's browser bridge and carries out what its
// macros ask for in the active tab.
//
// Blockwork listens on ws://127.0.0.1:<port>. Both sides prove they know the
// pairing key (HMAC-SHA256 over the other side's nonce) before anything else
// is said, so a web page can't pose as the extension and another program on
// the port can't drive the browser.
/* global importScripts */
if (typeof importScripts === "function") importScripts("protocol.js");

const api = globalThis.browser ?? globalThis.chrome;
const { hmacHex, randomHex, PROTOCOL } = globalThis.BlockworkProtocol;

const DEFAULT_PORT = 8788;
const KEEPALIVE_MS = 20000;
const DEFAULT_WAIT_MS = 5000;

let socket = null;
let status = { state: "starting", detail: "" };
let retryMs = 1000;
let retryTimer = null;
let keepalive = null;
let pickWaiter = null;

function setStatus(state, detail = "") {
  status = { state, detail };
  api.runtime.sendMessage({ type: "status", status }).catch?.(() => {});
}

async function settings() {
  const stored = await api.storage.local.get(["port", "key"]);
  return { port: Number(stored.port) || DEFAULT_PORT, key: String(stored.key || "").trim() };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, 30000);
}

async function connect() {
  clearTimeout(retryTimer);
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  const { port, key } = await settings();
  if (!key) {
    setStatus("unpaired", "Paste the pairing key from Blockwork's Settings > Integrations.");
    return;
  }
  setStatus("connecting", `ws://127.0.0.1:${port}`);
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}/blockwork`);
  } catch (e) {
    setStatus("waiting", String(e));
    return scheduleRetry();
  }
  socket = ws;
  let trusted = false;
  let ourNonce = "";

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!trusted) {
      if (msg.type === "hello") {
        ourNonce = randomHex(16);
        const info = await browserInfo();
        ws.send(JSON.stringify({
          type: "auth",
          protocol: PROTOCOL,
          nonce: ourNonce,
          mac: await hmacHex(key, "client:" + msg.nonce),
          browser: info.name,
          extension: api.runtime.getManifest().version,
        }));
      } else if (msg.type === "welcome") {
        if (msg.mac !== (await hmacHex(key, "server:" + ourNonce))) {
          setStatus("denied", "Something on this port isn't Blockwork, or it has another pairing key.");
          ws.close();
          return;
        }
        trusted = true;
        retryMs = 1000;
        setStatus("connected", `Blockwork ${msg.version || ""}`.trim());
        sendFocus();
        clearInterval(keepalive);
        keepalive = setInterval(() => send({ type: "ping" }), KEEPALIVE_MS);
      } else if (msg.type === "denied") {
        setStatus("denied", msg.reason || "Blockwork refused the pairing key.");
        ws.close();
      }
      return;
    }
    if (msg.type === "request") handle(msg);
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    clearInterval(keepalive);
    if (status.state !== "denied") {
      setStatus("waiting", "Blockwork isn't running, or browser control is off in its Settings > Integrations.");
      scheduleRetry();
    }
  };
  ws.onerror = () => {};
}

function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

async function browserInfo() {
  if (api.runtime.getBrowserInfo) {
    const info = await api.runtime.getBrowserInfo();
    return { name: `${info.name} ${info.version}` };
  }
  const brand = navigator.userAgentData?.brands?.find((b) => !/Not.A.Brand|Chromium/i.test(b.brand));
  return { name: brand ? `${brand.brand} ${brand.version}` : "Chromium" };
}

async function sendFocus() {
  try {
    const win = await api.windows.getLastFocused();
    send({ type: "focus", focused: !!win?.focused });
  } catch {}
}

api.windows.onFocusChanged.addListener((id) => send({ type: "focus", focused: id !== api.windows.WINDOW_ID_NONE }));

// ── Requests ────────────────────────────────────────────────────────────────

async function handle(msg) {
  try {
    const result = await run(msg.cmd, msg.args || {});
    send({ type: "response", id: msg.id, ok: true, result });
  } catch (e) {
    send({ type: "response", id: msg.id, ok: false, error: String(e?.message || e) });
  }
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("the browser has no open tab");
  return tab;
}

function restricted(tab, error) {
  const url = tab.url || "";
  if (/^(chrome|edge|about|moz-extension|chrome-extension|view-source):/.test(url) || /chromewebstore\.google\.com|addons\.mozilla\.org/.test(url)) {
    return new Error(`the browser doesn't let extensions into this page (${url})`);
  }
  return error;
}

// Runs one engine op in the tab's frames: every frame, or the listed ones.
async function inFrames(tab, op, args, frameIds) {
  const target = frameIds ? { tabId: tab.id, frameIds } : { tabId: tab.id, allFrames: true };
  const call = () =>
    api.scripting.executeScript({
      target,
      func: (op, args) => {
        if (!globalThis.BlockworkEngine) return { noEngine: true };
        try {
          return globalThis.BlockworkEngine.run(op, args);
        } catch (e) {
          return { error: String(e?.message || e) };
        }
      },
      args: [op, args],
    });
  let results;
  try {
    results = await call();
    if (results.some((r) => r.result?.noEngine)) {
      await api.scripting.executeScript({ target, files: ["engine.js"] });
      results = await call();
    }
  } catch (e) {
    throw restricted(tab, e);
  }
  return results
    .filter((r) => r.result && !r.result.noEngine)
    .sort((a, b) => (a.frameId || 0) - (b.frameId || 0));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits up to `wait` ms for the selector to match, then runs the op in the
// first frame that has enough matches.
async function onElement(op, args) {
  const tab = await activeTab();
  const nth = Number(args.nth) || 1;
  const deadline = Date.now() + (args.wait ?? DEFAULT_WAIT_MS);
  let seen = 0;
  for (;;) {
    const counts = await inFrames(tab, "count", { selector: args.selector });
    const failed = counts.find((r) => r.result.error);
    if (failed) throw new Error(failed.result.error);
    seen = counts.reduce((sum, r) => sum + r.result.count, 0);
    const frame = counts.find((r) => r.result.count >= Math.abs(nth));
    if (frame) {
      const [done] = await inFrames(tab, op, args, [frame.frameId || 0]);
      if (done?.result?.error) throw new Error(done.result.error);
      if (done && !done.result.missing) return done.result;
    }
    if (Date.now() >= deadline) break;
    await sleep(100);
  }
  if (seen === 0) throw new Error(`nothing on the page matches ${args.selector}`);
  throw new Error(`only ${seen} element${seen === 1 ? "" : "s"} match ${args.selector}, so there's no match #${nth}`);
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const done = () => {
      api.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, change) => {
      if (id === tabId && change.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    api.tabs.onUpdated.addListener(listener);
  });
}

async function run(cmd, args) {
  switch (cmd) {
    case "info": {
      const tab = await activeTab();
      return { url: tab.url || "", title: tab.title || "", browser: (await browserInfo()).name };
    }
    case "open": {
      let url = String(args.url || "").trim();
      if (!url) throw new Error("give a web address to open");
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
      const tab = args.newTab ? await api.tabs.create({ url, active: true }) : await api.tabs.update((await activeTab()).id, { url });
      await waitForLoad(tab.id, args.wait ?? 30000);
      return { url };
    }
    case "count": {
      const tab = await activeTab();
      const counts = await inFrames(tab, "count", { selector: args.selector });
      const failed = counts.find((r) => r.result.error);
      if (failed) throw new Error(failed.result.error);
      return { count: counts.reduce((sum, r) => sum + r.result.count, 0) };
    }
    case "click":
    case "type":
    case "read":
      return onElement(cmd, args);
    case "script": {
      const tab = await activeTab();
      let results;
      try {
        results = await api.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async (code) => {
            try {
              let fn;
              try {
                fn = new Function(`return (${code}\n)`);
              } catch {
                fn = new Function(code);
              }
              const value = await fn();
              if (value === undefined || value === null) return { value: "" };
              return { value: typeof value === "object" ? JSON.stringify(value) : String(value) };
            } catch (e) {
              const csp = /unsafe-eval|Content Security Policy|EvalError/i.test(String(e));
              return { error: csp ? "this page's security policy blocks scripts from extensions" : String(e?.message || e) };
            }
          },
          args: [String(args.code || "")],
        });
      } catch (e) {
        throw restricted(tab, e);
      }
      const result = results[0]?.result;
      if (!result) throw new Error("the script didn't run");
      if (result.error) throw new Error(result.error);
      return result;
    }
    case "pick": {
      const tab = await activeTab();
      await startPicker(tab);
      const selector = await new Promise((resolve, reject) => {
        pickWaiter?.reject(new Error("another pick started"));
        const timer = setTimeout(() => reject(new Error("nothing was picked")), args.wait ?? 120000);
        pickWaiter = {
          resolve: (s) => (clearTimeout(timer), resolve(s)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        };
      });
      return { selector };
    }
    default:
      throw new Error(`this version of the extension can't ${cmd}; update it`);
  }
}

async function startPicker(tab) {
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["engine.js", "picker.js"] });
  } catch (e) {
    throw restricted(tab, e);
  }
}

// ── Popup, picker and context menu ──────────────────────────────────────────

api.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "getStatus") {
    settings().then((s) => reply({ status, port: s.port, paired: !!s.key }));
    return true;
  }
  if (msg.type === "saveSettings") {
    api.storage.local.set({ port: Number(msg.port) || DEFAULT_PORT, key: String(msg.key || "").trim() }).then(() => {
      socket?.close();
      socket = null;
      status = { state: "connecting", detail: "" };
      retryMs = 1000;
      connect();
      reply({ ok: true });
    });
    return true;
  }
  if (msg.type === "pick") {
    activeTab().then(startPicker).then(() => reply({ ok: true }), (e) => reply({ error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === "picked") {
    if (pickWaiter) {
      if (msg.selector) pickWaiter.resolve(msg.selector);
      else pickWaiter.reject(new Error("the pick was cancelled"));
      pickWaiter = null;
    }
    if (msg.selector) send({ type: "picked", selector: msg.selector, url: msg.url || "" });
  }
  return false;
});

const MENU_ID = "blockwork-copy-selector";

async function makeMenu() {
  await api.contextMenus.removeAll();
  api.contextMenus.create({ id: MENU_ID, title: "Copy Blockwork selector", contexts: ["all"] });
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;
  const target = { tabId: tab.id, frameIds: [info.frameId || 0] };
  try {
    let [res] = await api.scripting.executeScript({
      target,
      func: () => globalThis.BlockworkEngine?.run("selectorFor", {}) ?? { error: "reload the page, then right-click the element again" },
    });
    const result = res?.result || {};
    await api.scripting.executeScript({
      target,
      func: (selector, error) => {
        const show = (html) => {
          const note = document.createElement("div");
          note.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";
          const s = note.attachShadow({ mode: "closed" });
          s.innerHTML = `<div style="position:fixed;left:50%;top:16px;transform:translateX(-50%);font:12px/1.4 system-ui,sans-serif;color:#fff;background:#1d1b26;border-radius:6px;padding:6px 9px;max-width:480px;pointer-events:auto;user-select:text">${html}</div>`;
          document.documentElement.append(note);
          setTimeout(() => note.remove(), 5000);
        };
        const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
        if (error) return show(`<b>Blockwork:</b> ${esc(error)}`);
        const area = document.createElement("textarea");
        area.value = selector;
        area.style.cssText = "position:fixed;opacity:0";
        document.documentElement.append(area);
        area.select();
        const copied = document.execCommand("copy");
        area.remove();
        const code = `<code style="font:12px ui-monospace,monospace;color:#c9b8ff;word-break:break-all">${esc(selector)}</code>`;
        show(`<b>${copied ? "Copied" : "Selector"}:</b> ${code}`);
        if (!copied) navigator.clipboard?.writeText(selector).catch(() => {});
      },
      args: [result.selector || "", result.error || ""],
    });
  } catch (e) {
    console.warn("Blockwork selector:", restricted(tab, e));
  }
});

// ── Lifetime ────────────────────────────────────────────────────────────────

// An alarm wakes a sleeping service worker so it can reconnect.
api.alarms.create("reconnect", { periodInMinutes: 0.5 });
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "reconnect") connect();
});
api.runtime.onStartup.addListener(connect);
makeMenu();
connect();
