// Finds and acts on page elements for Blockwork. Loaded into every frame as a
// content script, or injected on demand into tabs opened before the install.
//
// A selector is one or more parts joined by ">>", each searching inside what
// the part before it matched:
//   css (the default)  button.sqrt, or css=button.sqrt
//   text=Square root   reads "Square root" (any case), or contains it if none does;
//                      text="Square root" must match exactly
//   xpath=//button     an XPath expression
//   nth=2              keeps only the 2nd match so far (-1 is the last)
//   focused            the element that has the keyboard
//   closest=.card      the nearest enclosing .card of each match so far
//   near=button        the buttons in the closest enclosing element that has
//                      any, nearest first
// So `.keypad >> nth=2 >> text=More` is the More button in the second keypad,
// and `focused >> near=button` the button beside the field being typed in.
(() => {
  if (globalThis.BlockworkEngine) return;

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

  function splitParts(selector) {
    const parts = [];
    let current = "";
    let quote = null;
    for (let i = 0; i < selector.length; i++) {
      const c = selector[i];
      if (quote) {
        if (c === "\\" && i + 1 < selector.length) {
          current += c + selector[++i];
          continue;
        }
        if (c === quote) quote = null;
        current += c;
      } else if (c === '"' || c === "'") {
        quote = c;
        current += c;
      } else if (c === ">" && selector[i + 1] === ">") {
        parts.push(current.trim());
        current = "";
        i++;
      } else {
        current += c;
      }
    }
    parts.push(current.trim());
    if (parts.some((p) => !p)) throw new Error(`"${selector}" has an empty part around >>`);
    return parts;
  }

  // Every element under `root`, through open shadow roots too.
  function* allElements(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      const kids = node.shadowRoot ? [...node.children, ...node.shadowRoot.children] : [...node.children];
      for (let i = kids.length - 1; i >= 0; i--) {
        yield kids[i];
        stack.push(kids[i]);
      }
    }
  }

  function cssAll(scope, css) {
    const found = [...scope.querySelectorAll(css)];
    for (const el of allElements(scope)) {
      if (el.shadowRoot) found.push(...el.shadowRoot.querySelectorAll(css));
    }
    return found;
  }

  function visible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role=button], [role=link], [role=menuitem], [role=tab], [role=option], [onclick]";

  // The names an element answers to besides its text.
  function labels(el) {
    const names = [];
    for (const attr of ["aria-label", "title", "alt", "placeholder"]) {
      const v = el.getAttribute(attr);
      if (v) names.push(norm(v));
    }
    if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type)) names.push(norm(el.value));
    return names;
  }

  function textAll(scope, spec) {
    let exact = false;
    let want = spec;
    if (/^(["']).*\1$/s.test(spec)) {
      exact = true;
      want = spec.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    want = norm(want);
    const lower = want.toLowerCase();
    const same = (s) => (exact ? s === want : s.toLowerCase() === lower);
    const has = (s) => s.toLowerCase().includes(lower);
    const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE"]);
    const pick = (test) => {
      const byText = [];
      const byLabel = [];
      for (const el of allElements(scope)) {
        if (SKIP.has(el.tagName)) continue;
        if (labels(el).some(test)) byLabel.push(el);
        if (test(norm(el.textContent))) byText.push(el);
      }
      // Only the deepest elements whose text matches, not every ancestor too,
      // each lifted to the clickable element around it with the same text
      // (the button rather than the span inside it).
      const above = new Set();
      for (const el of byText) {
        for (let up = el.parentElement; up && !above.has(up); up = up.parentElement) above.add(up);
      }
      const deepest = byText
        .filter((el) => !above.has(el))
        .map((el) => {
          const own = norm(el.textContent);
          for (let up = el; up && up !== scope && norm(up.textContent) === own; up = up.parentElement) {
            if (up.matches(INTERACTIVE)) return up;
          }
          return el;
        });
      const merged = new Set([...byLabel, ...deepest]);
      return [...merged].filter(visible);
    };
    const hits = pick(same);
    return hits.length || exact ? hits : pick(has);
  }

  function xpathAll(scope, expr) {
    const doc = scope.ownerDocument || scope;
    const result = doc.evaluate(expr, scope, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const found = [];
    for (let i = 0; i < result.snapshotLength; i++) {
      const node = result.snapshotItem(i);
      if (node.nodeType === Node.ELEMENT_NODE) found.push(node);
    }
    return found;
  }

  function inOrder(elements) {
    const unique = [...new Set(elements)];
    return unique.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_DISCONNECTED) return 0;
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function search(scope, part) {
    if (/^text\s*=/i.test(part)) return textAll(scope, part.replace(/^text\s*=\s*/i, ""));
    if (/^xpath\s*=/i.test(part)) return xpathAll(scope, part.replace(/^xpath\s*=\s*/i, ""));
    return cssAll(scope, part.replace(/^css\s*=\s*/i, ""));
  }

  // The element with the keyboard, inside shadow roots too.
  function focusedElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    // A focused frame is that frame's business: its own engine answers.
    if (!el || el === document.body || el === document.documentElement || el.tagName === "IFRAME" || el.tagName === "FRAME") return null;
    return el;
  }

  // Matches of `part` around `el`: in its closest ancestor that has any,
  // nearest first. So `focused >> near=button` is the focused field's own button.
  function nearest(el, part) {
    if (!(el instanceof Element)) return search(el, part);
    const from = el.getBoundingClientRect();
    for (let up = el; up; up = up.parentElement || up.getRootNode().host) {
      const found = search(up, part).filter((m) => m !== el);
      if (found.length) {
        const gap = (m) => {
          const r = m.getBoundingClientRect();
          return Math.hypot(r.left + r.width / 2 - (from.left + from.width / 2), r.top + r.height / 2 - (from.top + from.height / 2));
        };
        return found.sort((a, b) => gap(a) - gap(b));
      }
      if (up === document.documentElement) break;
    }
    return [];
  }

  function findAll(selector) {
    let scopes = [document];
    for (const part of splitParts(String(selector))) {
      const nth = /^nth\s*=\s*(-?\d+)$/i.exec(part);
      if (nth) {
        const n = parseInt(nth[1], 10);
        const el = n < 0 ? scopes[scopes.length + n] : scopes[n - 1];
        scopes = el && n !== 0 ? [el] : [];
        continue;
      }
      if (/^focused$/i.test(part)) {
        const el = focusedElement();
        scopes = el ? [el] : [];
        continue;
      }
      const next = [];
      for (const scope of scopes) {
        const closest = /^closest\s*=\s*(.+)$/is.exec(part);
        const near = /^near\s*=\s*(.+)$/is.exec(part);
        if (closest) {
          const up = scope instanceof Element ? scope.closest(closest[1]) : null;
          if (up) next.push(up);
        } else if (near) {
          next.push(...nearest(scope, near[1]));
        } else {
          next.push(...search(scope, part));
        }
      }
      // `near` keeps its nearest-first order.
      scopes = /^near\s*=/i.test(part) ? [...new Set(next)] : inOrder(next);
    }
    return scopes.filter((s) => s !== document);
  }

  function nthOf(selector, nth) {
    const found = findAll(selector);
    const n = Number(nth) || 1;
    const el = n < 0 ? found[found.length + n] : found[n - 1];
    return { el, count: found.length };
  }

  function describe(el) {
    let text = norm(el.getAttribute("aria-label") || el.textContent || el.value || "");
    if (text.length > 40) text = text.slice(0, 39) + "…";
    return `<${el.tagName.toLowerCase()}>${text ? " " + text : ""}`;
  }

  function point(el) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function click(el, button) {
    const { x, y } = point(el);
    const which = { left: 0, middle: 1, right: 2 }[button] ?? 0;
    // The topmost element there gets the events, as with a real click, when it
    // is the target or inside it.
    const top = document.elementFromPoint(x, y);
    const target = top && (top === el || el.contains(top)) ? top : el;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: which, view: window };
    const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
    target.dispatchEvent(new PointerEvent("pointerover", pointer));
    target.dispatchEvent(new MouseEvent("mouseover", base));
    target.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 << which }));
    target.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 << which }));
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    target.dispatchEvent(new PointerEvent("pointerup", pointer));
    target.dispatchEvent(new MouseEvent("mouseup", base));
    if (which === 0) target.dispatchEvent(new MouseEvent("click", { ...base, detail: 1 }));
    else if (which === 2) target.dispatchEvent(new MouseEvent("contextmenu", base));
    else target.dispatchEvent(new MouseEvent("auxclick", base));
  }

  // Sets a field the way typing would, so frameworks that track the value
  // (React and friends) see the change.
  function type(el, text, append) {
    point(el);
    el.focus({ preventScroll: true });
    const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    if (field) {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, append ? el.value + text : text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (el.isContentEditable) {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      if (append) range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand("insertText", false, text)) {
        if (!append) el.textContent = "";
        el.append(text);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      }
      return;
    }
    if (el instanceof HTMLSelectElement) {
      const option = [...el.options].find((o) => o.value === text || norm(o.textContent) === norm(text));
      if (!option) throw new Error(`the list has no option "${text}"`);
      el.value = option.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    throw new Error(`${describe(el)} isn't a text field`);
  }

  function readText(el, what) {
    switch (what || "text") {
      case "value":
        return "value" in el ? String(el.value) : norm(el.textContent);
      case "html":
        return el.outerHTML;
      case "text":
        return "value" in el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
          ? String(el.value)
          : norm(el.innerText ?? el.textContent);
      default:
        return el.getAttribute(what) ?? "";
    }
  }

  // ── Selectors for the picker ─────────────────────────────────────────────

  const cssEscape = (s) => (globalThis.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, (c) => "\\" + c));
  const quoteAttr = (s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  // Ids and classes that look generated (css-1x2y3z, :r1:, ember123) change
  // between page loads, so they make poor selectors.
  const looksGenerated = (s) => /\d{3,}|^[a-z]{1,3}-[a-z0-9]{5,}$|[:]|^[A-Za-z0-9_-]{16,}$/.test(s) || /[A-Z].*\d|\d.*[A-Z]/.test(s);

  function unique(selector, el) {
    try {
      const found = findAll(selector);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  }

  function quoteText(s) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  // One step of a CSS path: the tag plus whatever tells it from its siblings.
  function step(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !looksGenerated(el.id)) return "#" + cssEscape(el.id);
    const parent = el.parentElement;
    if (!parent) return tag;
    const same = [...parent.children].filter((k) => k.tagName === el.tagName);
    return same.length === 1 ? tag : `${tag}:nth-of-type(${same.indexOf(el) + 1})`;
  }

  // A selector that matches `el` and nothing else, as readable as we can find.
  function attrCandidates(el) {
    const tag = el.tagName.toLowerCase();
    const candidates = [];
    if (el.id && !looksGenerated(el.id)) candidates.push("#" + cssEscape(el.id));
    for (const attr of ["data-testid", "data-test", "data-qa", "data-cy", "name", "aria-label", "title", "placeholder", "alt"]) {
      const v = el.getAttribute(attr);
      if (v && v.length <= 60) candidates.push(`${tag}[${attr}=${quoteAttr(v)}]`);
    }
    return candidates;
  }

  function selectorFor(el) {
    const tag = el.tagName.toLowerCase();
    const candidates = attrCandidates(el);
    const text = norm(el.textContent);
    if (text && text.length <= 40) candidates.push(`text=${quoteText(text)}`);
    const classes = [...el.classList].filter((c) => !looksGenerated(c)).slice(0, 3);
    if (classes.length) candidates.push(tag + classes.map((c) => "." + cssEscape(c)).join(""));
    for (const c of candidates) if (unique(c, el)) return c;

    // Scope a candidate inside the nearest ancestor that is easy to name.
    for (let up = el.parentElement, depth = 0; up && up !== document.body && depth < 6; up = up.parentElement, depth++) {
      const anchor = selectorFor.anchor(up);
      if (!anchor) continue;
      for (const c of candidates) {
        const scoped = `${anchor} >> ${c}`;
        if (unique(scoped, el)) return scoped;
      }
    }

    // Beside something easy to name, like the field a button belongs to.
    for (let up = el.parentElement, depth = 0; up && up !== document.body && depth < 3; up = up.parentElement, depth++) {
      for (const other of up.querySelectorAll("input, textarea, select, label, [aria-label], [id], [name]")) {
        if (other === el || other.contains(el) || el.contains(other)) continue;
        const named = attrCandidates(other).find((c) => unique(c, other));
        if (!named) continue;
        for (const c of candidates) {
          const s = `${named} >> near=${c}`;
          if (unique(s, el)) return s;
        }
      }
    }

    // Still more than one: say which one it is.
    for (const c of candidates) {
      const found = (() => { try { return findAll(c); } catch { return []; } })();
      const i = found.indexOf(el);
      if (i >= 0 && found.length <= 20) return `${c} >> nth=${i + 1}`;
    }

    // A full path from the nearest named ancestor down.
    const path = [];
    for (let node = el; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      const s = step(node);
      path.unshift(s);
      if (s.startsWith("#") || node === document.body) break;
      const joined = path.join(" > ");
      if (unique(joined, el)) return joined;
    }
    return path.join(" > ");
  }
  selectorFor.anchor = (el) => {
    if (el.id && !looksGenerated(el.id)) return "#" + cssEscape(el.id);
    for (const attr of ["data-testid", "aria-label", "role"]) {
      const v = el.getAttribute(attr);
      if (v && attr !== "role") {
        const s = `${el.tagName.toLowerCase()}[${attr}=${quoteAttr(v)}]`;
        if (unique(s, el)) return s;
      }
    }
    return null;
  };

  // ── The ops background.js calls ──────────────────────────────────────────

  function run(op, args) {
    args = args || {};
    switch (op) {
      case "count":
        return { count: findAll(args.selector).length };
      case "click":
      case "type":
      case "read": {
        const { el, count } = nthOf(args.selector, args.nth);
        if (!el) return { missing: true, count };
        if (op === "click") click(el, args.button);
        else if (op === "type") type(el, String(args.text ?? ""), !!args.append);
        else return { value: readText(el, args.what) };
        return { done: describe(el) };
      }
      case "selectorFor": {
        const el = args.target || globalThis.__blockworkContextTarget;
        if (!el || !el.isConnected) return { error: "right-click the element again" };
        return { selector: selectorFor(el), count: 1 };
      }
      default:
        throw new Error(`unknown op ${op}`);
    }
  }

  // Remembers the element under a right-click, for "Copy Blockwork selector".
  document.addEventListener(
    "contextmenu",
    (e) => {
      globalThis.__blockworkContextTarget = e.composedPath()[0] instanceof Element ? e.composedPath()[0] : e.target;
    },
    true,
  );

  globalThis.BlockworkEngine = { run, findAll, selectorFor, describe, splitParts };
})();
