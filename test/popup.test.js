import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Minimal DOM stand-in: enough for popup.js, and it records text vs. HTML.
class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.hidden = false;
    this._text = "";
  }
  append(...parts) {
    for (const p of parts) this.children.push(typeof p === "string" ? { text: p } : p);
  }
  replaceChildren(...parts) {
    this.children = [];
    this.append(...parts);
  }
  set innerHTML(value) {
    this.parsedHtml = value;
  }
  set textContent(value) {
    this._text = value;
  }
  get textContent() {
    return this._text + this.children.map((c) => (c instanceof FakeNode ? c.textContent : c.text)).join("");
  }
}

async function loadPopup(publishResponse) {
  const els = new Map();
  const document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, new FakeNode("div"));
      return els.get(id);
    },
    createElement: (tag) => new FakeNode(tag)
  };
  const fetch = async (url) => {
    if (url.endsWith("/api/publish-local")) return publishResponse;
    return { ok: true, json: async () => ({ cloudflare: { loggedIn: true, projectName: "p" } }) };
  };
  const chrome = {
    tabs: { query: async () => [{ url: "file:///tmp/report.html" }], create() {} }
  };
  const context = { document, fetch, chrome, navigator: {}, AbortController, setTimeout, clearTimeout, URL };
  const source = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context);
  await new Promise((r) => setTimeout(r, 0));
  return els;
}

test("a server error message is shown as text in the hint, never parsed as HTML", async () => {
  const payload = '<img src=x onerror="alert(1)">';
  const els = await loadPopup({ ok: false, status: 500, json: async () => ({ error: { message: payload } }) });
  await els.get("publish").onclick();
  const hint = els.get("hint");
  assert.equal(hint.hidden, false);
  assert.equal(hint.parsedHtml, undefined);
  assert.equal(hint.textContent, payload);
});

test("the sign-in hint links to the local Pagecast server", async () => {
  const els = await loadPopup({ ok: false, status: 401, json: async () => ({}) });
  await els.get("publish").onclick();
  const link = els.get("hint").children.find((c) => c.tagName === "a");
  assert.equal(link.href, "http://127.0.0.1:4173");
  assert.equal(els.get("hint").textContent, "Open Pagecast to sign in, then try again.");
});
