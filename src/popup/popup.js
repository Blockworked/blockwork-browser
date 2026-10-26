const api = globalThis.browser ?? globalThis.chrome;

const STATES = {
  starting: "Starting",
  unpaired: "Not paired yet",
  connecting: "Connecting",
  waiting: "Waiting for Blockwork",
  connected: "Connected to Blockwork",
  denied: "Pairing refused",
};

const $ = (id) => document.getElementById(id);

function render(status) {
  $("dot").className = "dot " + status.state;
  $("state").textContent = STATES[status.state] || status.state;
  $("detail").textContent = status.detail || "";
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
    return;
  }
  window.close();
});

api.runtime.onMessage.addListener((msg) => {
  if (msg.type === "status") render(msg.status);
});

refresh();
