// Point at an element, click it, and its Blockwork selector is copied.
// Injected by the popup's Pick button (and Blockwork's "pick" command) after
// engine.js. Escape cancels.
(() => {
  if (globalThis.__blockworkPicker) {
    globalThis.__blockworkPicker.stop();
    return;
  }
  const engine = globalThis.BlockworkEngine;
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      .box { position: fixed; border: 2px solid #1597ff; background: rgba(21,151,255,.15); border-radius: 3px; transition: all 60ms; }
      .tip, .toast { position: fixed; font: 12px/1.4 system-ui, sans-serif; color: #fff; background: #242527;
        border-radius: 6px; padding: 6px 9px; max-width: 480px; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
      .tip code, .toast code { font: 12px ui-monospace, monospace; color: #8cc8ff; word-break: break-all; }
      .toast { left: 50%; top: 16px; transform: translateX(-50%); }
      .hint { opacity: .7 }
    </style>
    <div class="box" hidden></div>
    <div class="tip" hidden></div>
    <div class="toast"><b>Blockwork:</b> click an element to copy its selector. <span class="hint">Esc cancels.</span></div>`;
  const box = shadow.querySelector(".box");
  const tip = shadow.querySelector(".tip");
  document.documentElement.append(host);

  let current = null;
  let currentSelector = "";

  const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function targetOf(e) {
    const path = e.composedPath();
    return path.find((n) => n instanceof Element && n !== host) || null;
  }

  function show(el) {
    if (el === current) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    box.hidden = false;
    currentSelector = engine.selectorFor(el);
    tip.innerHTML = `<code>${escape(currentSelector)}</code>`;
    tip.hidden = false;
    const below = r.bottom + 6 + 40 < innerHeight;
    Object.assign(tip.style, { left: Math.max(4, Math.min(r.left, innerWidth - 490)) + "px", top: (below ? r.bottom + 6 : Math.max(4, r.top - 40)) + "px" });
  }

  function onMove(e) {
    const el = targetOf(e);
    if (el) show(el);
  }

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;opacity:0";
      document.documentElement.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }

  async function onClick(e) {
    swallow(e);
    const el = targetOf(e);
    if (!el) return;
    show(el);
    const selector = currentSelector;
    stop(false);
    const copied = await copy(selector);
    try {
      chrome.runtime.sendMessage({ type: "picked", selector, url: location.href });
    } catch {}
    const note = document.createElement("div");
    note.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    const s = note.attachShadow({ mode: "closed" });
    s.innerHTML = `<div style="position:fixed;left:50%;top:16px;transform:translateX(-50%);font:12px/1.4 system-ui,sans-serif;color:#fff;background:#242527;border-radius:6px;padding:6px 9px;max-width:480px">
      <b>${copied ? "Copied" : "Selector"}:</b> <code style="font:12px ui-monospace,monospace;color:#8cc8ff;word-break:break-all">${escape(selector)}</code></div>`;
    document.documentElement.append(note);
    setTimeout(() => note.remove(), 3500);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      swallow(e);
      stop(true);
    }
  }

  const events = [
    ["mousemove", onMove],
    ["pointerdown", swallow],
    ["mousedown", swallow],
    ["pointerup", swallow],
    ["mouseup", swallow],
    ["click", onClick],
    ["keydown", onKey],
  ];
  for (const [type, handler] of events) addEventListener(type, handler, true);

  function stop(cancelled) {
    for (const [type, handler] of events) removeEventListener(type, handler, true);
    host.remove();
    delete globalThis.__blockworkPicker;
    if (cancelled) {
      try {
        chrome.runtime.sendMessage({ type: "picked", selector: "", cancelled: true });
      } catch {}
    }
  }

  globalThis.__blockworkPicker = { stop: () => stop(true) };
})();
