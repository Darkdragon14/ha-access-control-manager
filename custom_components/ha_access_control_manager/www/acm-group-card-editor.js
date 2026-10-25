// Home Assistant loads its editor elements lazily. Loading a stack editor also
// registers the native picker and single-card editor, without CDN dependencies.
const i18nURL = new URL('./acm-group-card-i18n.js', import.meta.url);
i18nURL.search = new URL(import.meta.url).search;
const { translate } = await import(i18nURL.href);
const EDITOR_TIMEOUT = 12000;
let nativeEditors;

function localizedError(key) {
  return Object.assign(new Error(key), { translationKey: key });
}

function withTimeout(promise, key) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(localizedError(key)), EDITOR_TIMEOUT);
    }),
  ]).finally(() => clearTimeout(timer));
}

function loadNativeEditors() {
  if (!nativeEditors) {
    nativeEditors = withTimeout((async () => {
      if (typeof window.loadCardHelpers !== "function") {
        throw localizedError("helpers_unavailable");
      }
      const helpers = await window.loadCardHelpers();
      await helpers.createCardElement({ type: "vertical-stack", cards: [] });
      await customElements.whenDefined("hui-vertical-stack-card");
      const stack = customElements.get("hui-vertical-stack-card");
      await stack.getConfigElement();
      await Promise.all([
        customElements.whenDefined("hui-card-picker"),
        customElements.whenDefined("hui-card-element-editor"),
      ]);
    })(), "native_timeout").catch((error) => {
      nativeEditors = undefined;
      throw error;
    });
  }
  return nativeEditors;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action) {
  const node = element("button", text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function sameConfig(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" ||
      Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(b, key) && sameConfig(a[key], b[key]));
}

export class AcmGroupCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._groups = [];
    this._catalogState = "idle";
    this._request = 0;
    this._nativeState = "idle";
    this._guiMode = true;
    this._guiModeAvailable = true;
    const style = element("style");
    style.textContent = `
      :host { display: block; color: var(--primary-text-color); }
      * { box-sizing: border-box; }
      h3 { margin: 16px 0 8px; font-size: 1rem; }
      p { line-height: 1.5; margin: 8px 0; }
      .notice, .status { color: var(--secondary-text-color); }
      .warning { color: var(--warning-color, var(--primary-text-color)); }
      .groups { display: grid; gap: 8px; }
      .group { display: flex; align-items: center; gap: 10px; min-height: 44px;
        padding: 8px; background: var(--secondary-background-color); border-radius: 8px; }
      .group input { flex: 0 0 auto; width: 20px; height: 20px; accent-color: var(--primary-color); }
      .group span { min-width: 0; overflow-wrap: anywhere; }
      small { display: block; color: var(--secondary-text-color); }
      .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
      button { min-height: 44px; padding: 8px 16px; cursor: pointer; font: inherit;
        color: var(--primary-text-color); background: var(--secondary-background-color);
        border: 1px solid var(--divider-color); border-radius: 8px; }
      button:disabled { opacity: .5; cursor: default; }
      button:focus-visible, input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
      .child { min-width: 0; }
    `;
    this._groupArea = element("section");
    this._toolbar = element("div", undefined, "toolbar");
    this._childArea = element("div", undefined, "child");
    this._notice = element("p", undefined, "notice");
    this._groupsTitle = element("h3");
    this._childTitle = element("h3");
    this.shadowRoot.append(style, this._notice, this._groupsTitle, this._groupArea,
      this._childTitle, this._toolbar, this._childArea);
  }

  connectedCallback() {
    this._render();
    this._loadEditors();
    this._loadGroups();
  }

  setConfig(config) {
    // Incomplete configurations are intentional while picking/removing a card.
    this._config = { ...config };
    this._picking = false;
    this._render();
  }

  set hass(hass) {
    const languageChanged = hass?.language !== this._hass?.language;
    const scope = [hass?.connection, hass?.user?.id, hass?.user?.is_admin,
      hass?.connection?.connected];
    const changed = !this._scope || scope.some((value, i) => value !== this._scope[i]);
    if (changed) {
      this._scope = scope;
      this._request++;
      this._groups = [];
      this._catalogState = "idle";
    }
    this._hass = hass;
    this._loadGroups();
    if (changed || languageChanged) this._render();
    else if (this._child) this._child.hass = hass;
  }

  get hass() { return this._hass; }
  set lovelace(value) {
    this._lovelace = value;
    if (this._child) this._child.lovelace = value;
  }
  get lovelace() { return this._lovelace; }

  _t(key, values) {
    return translate(this._hass?.language || document.documentElement?.lang ||
      globalThis.navigator?.language || "en", key, values);
  }

  _errorText(error, fallback) {
    return error?.translationKey ? this._t(error.translationKey)
      : error?.message || this._t(fallback);
  }

  async _loadEditors() {
    if (this._nativeState === "loading" || this._nativeState === "ready") return;
    this._nativeState = "loading";
    this._renderChild();
    try {
      await loadNativeEditors();
      this._nativeState = "ready";
    } catch (error) {
      this._nativeState = "error";
      this._nativeError = error;
    }
    this._renderChild();
  }

  async _loadGroups() {
    if (this._catalogState !== "idle" || !this._hass?.user?.id ||
        !this._hass.callWS || this._hass.connection?.connected === false) return;
    const request = ++this._request;
    this._catalogState = "loading";
    try {
      const result = await withTimeout(
        this._hass.callWS({ type: "ha_access_control/list_groups" }),
        "catalog_timeout");
      if (request !== this._request) return;
      if (!Array.isArray(result?.groups) || result.groups.some((group) =>
        typeof group?.id !== "string" || typeof group?.name !== "string")) {
        throw localizedError("invalid_catalog");
      }
      this._groups = result.groups;
      this._catalogState = "ready";
    } catch (error) {
      if (request !== this._request) return;
      this._catalogState = "error";
      this._catalogError = error;
    }
    this._renderGroups();
  }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config }, bubbles: true, composed: true,
    }));
    this._render();
  }

  _render() {
    this._notice.textContent = this._t("notice");
    this._groupsTitle.textContent = this._t("groups_title");
    this._childTitle.textContent = this._t("child_title");
    this._renderGroups();
    this._renderChild();
  }

  _renderGroups() {
    const area = this._groupArea;
    area.replaceChildren();
    const selected = Array.isArray(this._config.groups) ? this._config.groups : [];
    if (this._catalogState !== "ready") {
      area.append(element("p", this._catalogState === "error"
        ? this._t("catalog_error", { error: this._errorText(this._catalogError, "catalog_unavailable") })
        : this._t("catalog_loading"), "status"));
    } else if (!this._groups.length) {
      area.append(element("p", this._t("no_groups"), "status"));
    }
    if (this._catalogState === "error") {
      area.append(button(this._t("retry_groups"), () => {
        this._catalogState = "idle";
        this._loadGroups();
        this._renderGroups();
      }));
    }
    const groups = new Map(this._groups.map((group) => [group.id, group]));
    for (const id of selected) if (!groups.has(id)) groups.set(id, { id, unknown: true });
    const list = element("div", undefined, "groups");
    for (const group of groups.values()) {
      const label = element("label", undefined, "group");
      const input = element("input");
      input.type = "checkbox";
      input.checked = selected.includes(group.id);
      const description = element("span", group.unknown ? this._t("unknown_group") : group.name);
      description.append(element("small", String(group.id)));
      if (group.unknown) description.append(element("small",
        this._t("unknown_hint"), "warning"));
      input.addEventListener("change", () => {
        const current = Array.isArray(this._config.groups) ? this._config.groups : [];
        const groups = input.checked
          ? [...new Set([...current, group.id])]
          : current.filter((id) => id !== group.id);
        this._emit({ ...this._config, groups });
      });
      label.append(input, description);
      list.append(label);
    }
    area.append(list);
    if (!selected.length) area.append(element("p", this._t("select_group"), "warning"));
  }

  _renderChild() {
    this._toolbar.replaceChildren();
    if (this._nativeState !== "ready") {
      this._child = undefined;
      this._childArea.replaceChildren(element("p", this._nativeState === "error"
        ? this._t("native_error", { error: this._errorText(this._nativeError, "native_loading") })
        : this._t("native_loading"), "status"));
      if (this._nativeState === "error") {
        this._toolbar.append(button(this._t("retry_editor"), () => this._loadEditors()));
      }
      return;
    }
    const hasCard = this._config.card && typeof this._config.card === "object" &&
      !Array.isArray(this._config.card) && typeof this._config.card.type === "string" &&
      this._config.card.type.trim().length > 0;
    const picking = this._picking || !hasCard;
    if (hasCard) {
      this._toolbar.append(button(this._t(picking ? "cancel_replace" : "replace_card"), () => {
        this._picking = !picking;
        this._renderChild();
      }), button(this._t("remove_card"), () => {
        const config = { ...this._config };
        delete config.card;
        this._picking = false;
        this._emit(config);
      }));
    }
    const tag = picking ? "hui-card-picker" : "hui-card-element-editor";
    if (!this._child || this._child.localName !== tag) {
      this._child = element(tag);
      this._guiMode = true;
      this._guiModeAvailable = true;
      this._child.addEventListener("config-changed", (event) => {
        event.stopPropagation();
        if (event.currentTarget !== this._child) return;
        const card = event.detail?.config;
        if (!card || typeof card !== "object" || Array.isArray(card)) return;
        if (event.detail.guiModeAvailable !== undefined) {
          this._guiModeAvailable = event.detail.guiModeAvailable;
        }
        // Native HuiElementEditor fires this after assigning .value too.
        // Do not turn opening/setConfig, or its own feedback, into user edits.
        if (!picking && sameConfig(card, this._config.card)) {
          this._renderChild();
          return;
        }
        // Native editors return the full child config, including intentional removals.
        const next = { ...card };
        this._picking = false;
        this._emit({ ...this._config, card: next });
      });
      this._child.addEventListener("GUImode-changed", (event) => {
        event.stopPropagation();
        if (event.currentTarget !== this._child) return;
        this._guiMode = event.detail.guiMode;
        this._guiModeAvailable = event.detail.guiModeAvailable;
        this._renderChild();
      });
      this._childArea.replaceChildren(this._child);
    }
    this._child.hass = this._hass;
    this._child.lovelace = this._lovelace;
    if (!picking) {
      this._child.value = this._config.card;
      const toggle = button(this._t(this._guiMode ? "yaml_editor" : "visual_editor"), () => {
        this._child.toggleMode();
      });
      // A card without a GUI must still be allowed to enter YAML mode.
      toggle.disabled = !this._guiMode && this._guiModeAvailable === false;
      this._toolbar.append(toggle);
    }
  }
}

if (!customElements.get("acm-group-card-editor")) {
  customElements.define("acm-group-card-editor", AcmGroupCardEditor);
}
