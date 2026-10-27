const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const STATES = {
  starting: "Starting", unpaired: "Not paired", connecting: "Connecting…",
  waiting: "Offline", connected: "Connected", denied: "Key refused",
};
let paired = false;
let currentState = "starting";
let initialized = false;
let targetTab;

function problem(message) {
  $("detail").textContent = message;
  $("detail").hidden = !message;
}

function render(status) {
  currentState = status.state;
  $("dot").className = "dot " + status.state;
  $("state").textContent = STATES[status.state] || status.state;
  problem(status.state === "waiting" ? "Open Blockwork with Browser extension enabled. Retrying automatically."
    : status.state === "denied" ? "Pairing failed. Check your key in Blockwork." : "");
  $("connection-note").textContent = status.state === "connected" ? "Paired" : paired ? "Saved" : "Set up";
  if (status.state === "unpaired" || status.state === "denied") $("pairing").open = true;
  if (status.state === "connected") $("pairing").open = false;
  updateSave();
}

function updateSave() {
  const changed = $("key").value.trim() || $("port").value !== $("port").dataset.saved;
  $("save").textContent = currentState === "connected" ? "Save changes" : paired ? "Reconnect" : "Connect";
  $("save").disabled = currentState === "connected" && !changed;
}

async function refresh() {
  const info = await api.runtime.sendMessage({ type: "getStatus" });
  paired = info.paired;
  if (!initialized) {
    $("port").value = info.port;
    $("port").dataset.saved = String(info.port);
    $("key").placeholder = paired ? "Leave blank to keep saved key" : "Paste pairing key";
    if (!paired) $("pairing").open = true;
    initialized = true;
  }
  render(info.status);
}

$("connection-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("save").disabled = true;
  try {
    const result = await api.runtime.sendMessage({ type: "saveSettings", key: $("key").value, port: $("port").value });
    if (result?.error) throw new Error(result.error);
    $("key").value = "";
    initialized = false;
    await refresh();
  } catch (error) { problem(error.message); }
  finally { updateSave(); }
});
$("key").addEventListener("input", updateSave);
$("port").addEventListener("input", updateSave);

$("pick").addEventListener("click", async () => {
  try {
    const res = await api.runtime.sendMessage({ type: "pick", tabId: targetTab });
    if (res?.error) throw new Error(res.error);
    window.close();
  } catch (error) { problem(error.message); }
});

$("check-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("check").disabled = true;
  $("matches").textContent = "Checking…";
  try {
    const res = await api.runtime.sendMessage({ type: "checkSelector", selector: $("selector").value.trim(), tabId: targetTab });
    if (res?.error) throw new Error(res.error);
    $("matches").textContent = res.count === 0 ? "No matches on this page." : `${res.count} ${res.count === 1 ? "match" : "matches"} on this page.`;
  } catch (error) { $("matches").textContent = error.message; }
  finally { $("check").disabled = false; }
});
$("selector").addEventListener("input", () => { $("matches").textContent = "Count matches on this page."; });

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("last-selector").textContent);
    $("copy").textContent = "Copied";
    setTimeout(() => { $("copy").textContent = "Copy"; }, 1500);
  } catch { problem("Couldn't copy. Select the selector below to copy it."); }
});

async function loadPage() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  targetTab = tab?.id;
  $("page-title").textContent = tab?.title || "Current tab";
  $("page-title").title = tab?.url || "";
  const allowed = /^https?:/.test(tab?.url || "");
  $("pick").disabled = !allowed;
  $("check").disabled = !allowed;
  $("selector").disabled = !allowed;
  if (!allowed) $("page-hint").textContent = "Open a web page to use these tools.";
  const { lastPicked } = await api.storage.local.get("lastPicked");
  if (lastPicked?.selector) {
    $("recent").hidden = false;
    $("last-selector").textContent = lastPicked.selector;
    $("last-selector").title = lastPicked.url || "";
    if (lastPicked.url === tab?.url) $("selector").value = lastPicked.selector;
  }
}
api.runtime.onMessage.addListener((msg) => { if (msg.type === "status") render(msg.status); });
refresh().catch((error) => problem(error.message));
loadPage().catch((error) => problem(error.message));

// Firefox's build runs only the scripts the user allowed; list them here.
async function renderScripts() {
  if (!globalThis.BlockworkTarget?.approveScripts) return;
  $("scriptsRow").hidden = false;
  const { scripts = [] } = await api.storage.local.get("scripts");
  $("scriptsNone").hidden = scripts.length > 0;
  $("scripts").replaceChildren(...scripts.map((script) => {
    const item = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = script.code.replace(/\s+/g, " ").trim();
    code.title = script.code;
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      const { scripts: now = [] } = await api.storage.local.get("scripts");
      await api.storage.local.set({ scripts: now.filter((s) => s.hash !== script.hash) });
      renderScripts();
    });
    item.append(code, remove);
    return item;
  }));
}
renderScripts();
