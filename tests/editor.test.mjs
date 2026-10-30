import assert from "node:assert/strict";
import test from "node:test";

// Local, deliberately small DOM: editor tests do not require npm packages or
// depend on another test suite's globals/harness.
class FakeElement extends EventTarget {
  constructor(tag = "host") {
    super();
    this.localName = tag;
    this.children = [];
    this._text = "";
  }
  attachShadow() { return this.shadowRoot = new FakeElement("shadow-root"); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; this._text = ""; }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set value(value) {
    if (JSON.stringify(this._value) === JSON.stringify(value)) return;
    this._value = value;
    // HA's native single-card editor reports configuration on assignment,
    // asynchronously after updateComplete, not just after a user's edit.
    if (this.localName === "hui-card-element-editor") {
      queueMicrotask(() => this.dispatchEvent(new CustomEvent("config-changed", {
        detail: { config: this._value, guiModeAvailable: true },
      })));
    }
  }
  get value() { return this._value; }
}
class FakeCustomEvent extends Event {
  constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
  stopPropagation() { this.stopped = true; super.stopPropagation(); }
}
const definitions = new Map();
const waiters = new Map();
globalThis.HTMLElement = FakeElement;
globalThis.CustomEvent = FakeCustomEvent;
globalThis.document = { documentElement: { lang: "en" }, createElement: (tag) => new FakeElement(tag) };
globalThis.customElements = {
  get: (tag) => definitions.get(tag),
  define(tag, ctor) {
    definitions.set(tag, ctor);
    waiters.get(tag)?.();
  },
  whenDefined(tag) {
    return definitions.has(tag) ? Promise.resolve() : new Promise((resolve) => waiters.set(tag, resolve));
  },
};
let helperLoads = 0;
let stackEditorLoads = 0;
const helper = {
  createCardElement(config) {
    assert.deepEqual(config, { type: "vertical-stack", cards: [] });
    customElements.define("hui-vertical-stack-card", class {
      static async getConfigElement() {
        stackEditorLoads++;
        customElements.define("hui-card-picker", FakeElement);
        customElements.define("hui-card-element-editor", FakeElement);
        return new FakeElement("hui-stack-card-editor");
      }
    });
    return new FakeElement("hui-vertical-stack-card");
  },
};
globalThis.window = { loadCardHelpers: async () => { helperLoads++; return helper; } };
const moduleURL = new URL("../custom_components/ha_access_control_manager/www/acm-group-card-editor.js", import.meta.url).href;
const { AcmGroupCardEditor } = await import(moduleURL);
const { translate } = await import("../custom_components/ha_access_control_manager/www/acm-group-card-i18n.js");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const find = (root, predicate) => {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
};
const byText = (root, text) => find(root, (node) => node.localName === "button" && node.textContent === text);
const click = (node) => { assert.ok(node); node.dispatchEvent(new Event("click")); };
const config = () => ({ type: "custom:acm-group-card", groups: ["known", "missing"],
  outer_option: { keep: true }, card: { type: "markdown", content: "hello", nested_option: { keep: true } } });
const hass = (callWS = async () => ({ groups: [{ id: "known", name: "Friendly group" }] })) => ({
  connection: { connected: true }, user: { id: "admin", is_admin: true }, callWS,
});
async function editor(value = config(), instanceHass = hass()) {
  const instance = new AcmGroupCardEditor();
  instance.setConfig(value);
  instance.hass = instanceHass;
  instance.connectedCallback();
  await tick();
  return instance;
}

test("bootstraps native modules from a cold frontend and never emits on initialization", async () => {
  const instance = new AcmGroupCardEditor();
  const events = [];
  instance.addEventListener("config-changed", (event) => events.push(event));
  instance.setConfig(config());
  instance.hass = hass();
  instance.connectedCallback();
  await tick();
  assert.equal(helperLoads, 1);
  assert.equal(stackEditorLoads, 1);
  assert.equal(instance._child.localName, "hui-card-element-editor");
  assert.equal(instance._child.hass, instance.hass);
  assert.deepEqual(instance._child.value, config().card);
  assert.deepEqual(events, []);
  instance.setConfig({ ...config(), card: { type: "markdown", content: "external config" } });
  await tick();
  assert.deepEqual(events, []);
  assert.match(instance.shadowRoot.textContent, /visibility, not security/);
  assert.match(instance.shadowRoot.textContent, /signed-in user/);
});

test("checkboxes show names and IDs, safely preserve and remove unknown selections", async () => {
  const instance = await editor();
  const emitted = [];
  instance.addEventListener("config-changed", (event) => emitted.push(event.detail.config));
  assert.match(instance._groupArea.textContent, /Friendly groupknown/);
  assert.match(instance._groupArea.textContent, /Unknown \/ unavailable groupmissing/);
  assert.match(instance._groupArea.textContent, /Uncheck to remove/);
  const unknownRow = find(instance._groupArea, (node) => node.localName === "label" && node.textContent.includes("missing"));
  const input = unknownRow.children[0];
  assert.equal(input.checked, true);
  input.checked = false;
  input.dispatchEvent(new Event("change"));
  assert.deepEqual(emitted[0], { ...config(), groups: ["known"] });
  assert.deepEqual(config().groups, ["known", "missing"]);
  const malicious = "<img src=x onerror=alert(1)>";
  instance._groups = [{ id: "known", name: malicious }];
  instance._renderGroups();
  assert.ok(instance._groupArea.textContent.includes(malicious));
  assert.equal(find(instance._groupArea, (node) => node.localName === "img"), undefined);
});

test("child edits are stopped and wrapped once, preserving outer and nested options", async () => {
  const instance = await editor();
  instance.lovelace = { title: "Dashboard" };
  const child = instance._child;
  assert.equal(child.lovelace, instance.lovelace);
  const emitted = [];
  instance.addEventListener("config-changed", (event) => emitted.push(event.detail.config));
  const event = new CustomEvent("config-changed", { detail: { config: { ...config().card, content: "changed" } } });
  child.dispatchEvent(event);
  assert.equal(event.stopped, true);
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], { ...config(), card: { ...config().card, content: "changed" } });
  assert.equal(instance._child, child);
  instance.hass = { ...instance.hass, states: { updated: true } };
  assert.equal(instance._child, child);
});

test("an empty stub opens the picker and child property deletions are respected", async () => {
  const instance = await editor();
  instance.setConfig({ type: "custom:acm-group-card", groups: [], card: {} });
  assert.equal(instance._child.localName, "hui-card-picker");
  instance.setConfig(config());
  instance._child.dispatchEvent(new CustomEvent("config-changed", {
    detail: { config: { type: "markdown", content: "without removed option" } },
  }));
  assert.equal("nested_option" in instance._config.card, false);
  assert.ok(instance._config.outer_option.keep);
});

test("replace/cancel/remove/pick use one native child and retain groups", async () => {
  const instance = await editor();
  const original = instance._config;
  click(byText(instance._toolbar, "Replace card"));
  assert.equal(instance._child.localName, "hui-card-picker");
  assert.equal(instance._config, original);
  click(byText(instance._toolbar, "Cancel replacement"));
  assert.equal(instance._child.localName, "hui-card-element-editor");
  click(byText(instance._toolbar, "Replace card"));
  instance._child.dispatchEvent(new CustomEvent("config-changed", {
    detail: { config: { type: "button", entity: "light.room" } },
  }));
  assert.deepEqual(instance._config.card, { type: "button", entity: "light.room" });
  assert.deepEqual(instance._config.groups, original.groups);
  click(byText(instance._toolbar, "Remove card"));
  assert.equal("card" in instance._config, false);
  assert.deepEqual(instance._config.groups, original.groups);
  assert.equal(instance._child.localName, "hui-card-picker");
  assert.ok(instance._config.outer_option.keep);
});

test("native GUI/YAML toggle follows GUI availability", async () => {
  const instance = await editor();
  let toggles = 0;
  instance._child.toggleMode = () => toggles++;
  click(byText(instance._toolbar, "Show YAML editor"));
  assert.equal(toggles, 1);
  const event = new CustomEvent("GUImode-changed", { detail: { guiMode: false, guiModeAvailable: false } });
  instance._child.dispatchEvent(event);
  assert.equal(event.stopped, true);
  assert.equal(byText(instance._toolbar, "Show visual editor").disabled, true);
  instance._child.dispatchEvent(new CustomEvent("GUImode-changed", {
    detail: { guiMode: false, guiModeAvailable: true },
  }));
  assert.equal(byText(instance._toolbar, "Show visual editor").disabled, false);
});

test("catalog failure stays quiet across state updates and supports explicit retry", async () => {
  let requests = 0;
  const state = hass(async (message) => {
    assert.deepEqual(message, { type: "ha_access_control/list_groups" });
    requests++;
    if (requests === 1) throw new Error("Forbidden");
    return { groups: [{ id: "known", name: "Recovered" }] };
  });
  const instance = await editor(config(), state);
  assert.match(instance._groupArea.textContent, /Cannot load groups/);
  instance.hass = { ...state, states: {} };
  await tick();
  assert.equal(requests, 1);
  click(byText(instance._groupArea, "Retry loading groups"));
  await tick();
  assert.equal(requests, 2);
  assert.match(instance._groupArea.textContent, /Recovered/);
});

test("identity/connection changes clear catalog and ignore stale results", async () => {
  let resolveOld;
  const old = hass(() => new Promise((resolve) => { resolveOld = resolve; }));
  const instance = await editor(config(), old);
  const next = { ...old, user: { id: "other", is_admin: true },
    callWS: async () => ({ groups: [{ id: "new", name: "New identity catalog" }] }) };
  instance.hass = next;
  assert.deepEqual(instance._groups, []);
  await tick();
  resolveOld({ groups: [{ id: "stale", name: "Stale response" }] });
  await tick();
  assert.deepEqual(instance._groups.map((group) => group.id), ["new"]);
  const connection = { connected: false };
  instance.hass = { ...next, connection };
  assert.deepEqual(instance._groups, []);
  connection.connected = true;
  instance.hass = { ...next, connection };
  await tick();
  assert.deepEqual(instance._groups.map((group) => group.id), ["new"]);
});

test("incomplete config is editable without initialization changes", async () => {
  const instance = await editor({ type: "custom:acm-group-card", groups: [], extra: true });
  assert.equal(instance._child.localName, "hui-card-picker");
  assert.match(instance._groupArea.textContent, /otherwise this card is hidden/);
  instance._child.dispatchEvent(new CustomEvent("config-changed", { detail: { config: { type: "markdown" } } }));
  assert.deepEqual(instance._config, { type: "custom:acm-group-card", groups: [], extra: true, card: { type: "markdown" } });
});

test("bootstrap errors are visible, bounded and explicitly retryable", async () => {
  const { AcmGroupCardEditor: FreshEditor } = await import(`${moduleURL}#bootstrap-failure`);
  window.loadCardHelpers = async () => { throw new Error("Frontend unavailable"); };
  const instance = new FreshEditor();
  instance.setConfig(config());
  instance.connectedCallback();
  await tick();
  assert.match(instance._childArea.textContent, /Frontend unavailable/);
  assert.equal(instance._child, undefined);
  window.loadCardHelpers = async () => helper;
  click(byText(instance._toolbar, "Retry loading card editor"));
  await tick();
  assert.equal(instance._child.localName, "hui-card-element-editor");
  // Check an unresolved native load is timed out too, without waiting 12 sec.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const pendingTimers = [];
  globalThis.setTimeout = (callback) => { pendingTimers.push(callback); return callback; };
  globalThis.clearTimeout = () => {};
  try {
    const { AcmGroupCardEditor: TimeoutEditor } = await import(`${moduleURL}#bootstrap-timeout`);
    window.loadCardHelpers = () => new Promise(() => {});
    const waiting = new TimeoutEditor();
    waiting.connectedCallback();
    pendingTimers.forEach((callback) => callback());
    await tick();
    assert.match(waiting._childArea.textContent, /took too long/);
    assert.ok(byText(waiting._toolbar, "Retry loading card editor"));
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    window.loadCardHelpers = async () => helper;
  }
});

test("language changes translate own UI without fetching groups, recreating child or editing config", async () => {
  let requests = 0;
  const state = { ...hass(async () => {
    requests++;
    return { groups: [{ id: "known", name: "User supplied group name" }] };
  }), language: "fr-CA" };
  const instance = await editor(config(), state);
  const child = instance._child;
  const events = [];
  instance.addEventListener("config-changed", event => events.push(event));
  assert.equal(instance._groupsTitle.textContent, translate("fr", "groups_title"));
  assert.equal(instance._notice.textContent, translate("fr", "notice"));
  assert.ok(byText(instance._toolbar, translate("fr", "replace_card")));
  assert.match(instance._groupArea.textContent, /User supplied group name/);
  assert.ok(instance._groupArea.textContent.includes(translate("fr", "unknown_group")));
  instance.hass = { ...state, language: "de" };
  await tick();
  assert.equal(instance._groupsTitle.textContent, translate("de", "groups_title"));
  assert.ok(byText(instance._toolbar, translate("de", "yaml_editor")));
  assert.equal(instance._child, child);
  assert.equal(child.hass.language, "de");
  assert.equal(requests, 1);
  assert.deepEqual(events, []);
  assert.deepEqual(instance._config, config());
  instance.hass = { ...state, language: "unsupported" };
  assert.ok(byText(instance._toolbar, "Replace card"));
});

test("stored internal failures translate again when the frontend language changes", async () => {
  const instance = await editor(config(), { ...hass(async () => ({ groups: [null] })), language: "fr" });
  assert.ok(instance._groupArea.textContent.includes(translate("fr", "invalid_catalog")));
  instance.hass = { ...instance.hass, language: "es" };
  assert.ok(instance._groupArea.textContent.includes(translate("es", "invalid_catalog")));
  assert.ok(byText(instance._groupArea, translate("es", "retry_groups")));
  const { AcmGroupCardEditor: FreshEditor } = await import(`${moduleURL}#localized-bootstrap`);
  const original = window.loadCardHelpers;
  window.loadCardHelpers = undefined;
  try {
    const editor = new FreshEditor();
    editor.hass = { ...hass(), language: "fr" };
    editor.connectedCallback();
    await tick();
    assert.ok(editor._childArea.textContent.includes(translate("fr", "helpers_unavailable")));
    editor.hass = { ...editor.hass, language: "it" };
    assert.ok(editor._childArea.textContent.includes(translate("it", "helpers_unavailable")));
  } finally { window.loadCardHelpers = original; }
});
