const api = globalThis.browser ?? globalThis.chrome;
const id = new URLSearchParams(location.search).get("id");
const $ = (x) => document.getElementById(x);

function note(text) {
  $("note").textContent = text;
  $("note").hidden = false;
}

api.runtime.sendMessage({ type: "approval", id }).then((pending) => {
  if (!pending || pending.gone) {
    $("code").textContent = "";
    note("This request has ended. Run the macro again to be asked again.");
    $("allow").disabled = true;
    return;
  }
  $("code").textContent = pending.code;
  try {
    $("site").textContent = new URL(pending.url).host || pending.url;
  } catch {
    $("site").textContent = pending.url || "this page";
  }
});

$("allow").addEventListener("click", async () => {
  // Firefox grants the userScripts permission on its own, from a click.
  if (api.permissions && !api.userScripts) {
    let granted = false;
    try {
      granted = await api.permissions.request({ permissions: ["userScripts"] });
    } catch {}
    if (!granted) return note("Run JavaScript needs the browser's permission to run scripts. Allow it, then try again.");
  }
  await api.runtime.sendMessage({ type: "decide", id, allow: true });
  window.close();
});

$("deny").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "decide", id, allow: false });
  window.close();
});
