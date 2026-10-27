const api = globalThis.browser ?? globalThis.chrome;

const STATES = {
  starting: "Starting",
  unpaired: "Not paired",
  connecting: "Connecting",
  waiting: "Waiting for Blockwork",
  connected: "Connected",
  denied: "Pairing refused",
};

const $ = (id) => document.getElementById(id);

function render(status) {
  $("dot").className = "dot " + status.state;
  $("state").textContent = STATES[status.state] || status.state;
  // Only problems get the callout; the pairing row already says what to paste.
  const problem = status.state === "waiting" || status.state === "denied";
  $("detail").textContent = problem ? status.detail || "" : "";
  $("detail").hidden = !problem || !status.detail;
  if (status.state === "unpaired" || status.state === "denied") $("pairing").open = true;
}

async function refresh() {
  const info = await api.runtime.sendMessage({ type: "getStatus" });
  render(info.status);
  $("port").value = info.port;
  if (!info.paired) $("pairing").open = true;
}

$("save").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "saveSettings", key: $("key").value, port: $("port").value });
  $("key").value = "";
  setTimeout(refresh, 400);
});

$("pick").addEventListener("click", async () => {
  const res = await api.runtime.sendMessage({ type: "pick" });
  if (res?.error) {
    $("detail").textContent = res.error;
    $("detail").hidden = false;
    return;
  }
  window.close();
});

api.runtime.onMessage.addListener((msg) => {
  if (msg.type === "status") render(msg.status);
});

refresh();

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
