// Visibility only. Entity/API permissions must still be enforced by Home Assistant.
const managers = new WeakMap();
const REFRESH_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

export class GroupMembership {
    constructor(connection) {
        this.connection = connection;
        this.listeners = new Set();
        this.groups = null;
        this.generation = 0;
        this.pending = false;
        this.onReady = () => { this.invalidate(); this.refresh(); };
        this.onDisconnected = () => this.invalidate();
        this.onVisibility = () => {
            if (document.visibilityState === 'visible') this.refresh();
        };
    }

    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.groups);
        if (this.listeners.size === 1) {
            this.connection.addEventListener('ready', this.onReady);
            this.connection.addEventListener('disconnected', this.onDisconnected);
            document.addEventListener('visibilitychange', this.onVisibility);
            this.interval = setInterval(() => this.refresh(), REFRESH_MS);
            this.refresh();
        }
        return () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) {
                clearInterval(this.interval);
                this.connection.removeEventListener('ready', this.onReady);
                this.connection.removeEventListener('disconnected', this.onDisconnected);
                document.removeEventListener('visibilitychange', this.onVisibility);
                this.invalidate();
            }
        };
    }

    publish(groups) {
        this.groups = groups;
        for (const listener of this.listeners) listener(groups);
    }

    invalidate() {
        this.generation += 1;
        this.pending = false;
        clearTimeout(this.timeout);
        this.publish(null);
    }

    refresh() {
        if (!this.listeners.size || this.pending) return;
        if (!this.connection.connected) {
            this.invalidate();
            return;
        }
        this.pending = true;
        const generation = ++this.generation;
        const finish = (groups) => {
            if (generation !== this.generation) return;
            clearTimeout(this.timeout);
            this.pending = false;
            this.publish(groups);
        };
        this.timeout = setTimeout(() => {
            finish(null);
            // A late response from this timed-out request must not grant visibility.
            this.generation += 1;
        }, REQUEST_TIMEOUT_MS);
        Promise.resolve().then(() => this.connection.sendMessagePromise({
            type: 'ha_access_control/current_user_groups',
        })).then((response) => {
            if (!Array.isArray(response?.groups) || response.groups.some(
                (group) => !group || typeof group.id !== 'string' || !group.id,
            )) throw new Error('Invalid ACM group response');
            finish(response.groups.map((group) => group.id));
        }).catch(() => finish(null));
    }
}

export function membershipFor(connection, userId) {
    let users = managers.get(connection);
    if (!users) {
        users = new Map();
        managers.set(connection, users);
    }
    if (!users.has(userId)) users.set(userId, new GroupMembership(connection));
    return users.get(userId);
}

export function validateConfig(config) {
    if (!config || !Array.isArray(config.groups) || !config.groups.length ||
        config.groups.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new Error('ACM: select at least one group.');
    }
    if (!config.card || typeof config.card !== 'object' || Array.isArray(config.card) ||
        typeof config.card.type !== 'string' || !config.card.type.trim()) {
        throw new Error('ACM: configure a child card.');
    }
}

export class AcmGroupCard extends HTMLElement {
    static async getConfigElement() {
        const url = new URL('./acm-group-card-editor.js', import.meta.url);
        url.search = new URL(import.meta.url).search;
        await import(url.href);
        return document.createElement('acm-group-card-editor');
    }

    static getStubConfig() {
        return { groups: [], card: {} };
    }

    constructor() {
        super();
        // hui-card normally detaches hidden children. Keep this empty wrapper
        // connected so it can receive group changes without instantiating its child.
        this.connectedWhileHidden = true;
        this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = ':host { display: block; height: 100%; } :host([hidden]) { display: none !important; } #content { height: 100%; }';
        this.content = document.createElement('div');
        this.content.id = 'content';
        this.shadowRoot.append(style, this.content);
        this.token = 0;
        this.groups = null;
    }

    setConfig(config) {
        // Clear any existing child even when a replacement config is invalid.
        this.config = null;
        this.clearChild();
        this.setVisible(false);
        validateConfig(config);
        this.config = structuredClone(config);
        this.syncChild();
    }

    set hass(hass) {
        this._hass = hass;
        this.bindMembership();
        if (this.child) this.child.hass = hass;
    }

    get hass() { return this._hass; }

    set layout(layout) {
        this._layout = layout;
        if (this.child) this.child.layout = layout;
    }

    get layout() { return this._layout; }

    connectedCallback() {
        this.setVisible(false);
        this.bindMembership();
    }

    disconnectedCallback() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.connection = null;
        this.userId = null;
        this.groups = null;
        this.clearChild();
        this.setVisible(false);
    }

    bindMembership() {
        if (!this.isConnected) return;
        const connection = this._hass?.connection;
        const userId = this._hass?.user?.id;
        if (connection === this.connection && userId === this.userId) return;
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.connection = connection;
        this.userId = userId;
        this.groups = null;
        this.syncChild();
        if (!connection || !userId) return;
        this.unsubscribe = membershipFor(connection, userId).subscribe((groups) => {
            this.groups = groups;
            this.syncChild();
        });
    }

    allowed() {
        return this.isConnected && this.config && this.groups &&
            this.config.groups.some((id) => this.groups.includes(id));
    }

    setVisible(visible) {
        if (this.hidden === !visible) return;
        this.hidden = !visible;
        this.dispatchEvent(new CustomEvent('card-visibility-changed', {
            detail: { value: visible }, bubbles: true, composed: true,
        }));
    }

    clearChild() {
        this.token += 1;
        this.creating = false;
        this.child = null;
        this.content.replaceChildren();
    }

    async syncChild() {
        if (!this.allowed()) {
            this.clearChild();
            this.setVisible(false);
            return;
        }
        if (this.child || this.creating) return;
        this.creating = true;
        const token = ++this.token;
        try {
            const helpers = await window.loadCardHelpers();
            if (token !== this.token || !this.allowed()) return;
            const config = structuredClone(this.config.card);
            // Use the same shell as native stacks when available. It preserves
            // the child's own visibility conditions, sizing and lazy upgrades.
            const nativeShell = customElements.get('hui-card');
            const child = nativeShell
                ? document.createElement('hui-card')
                : helpers.createCardElement(config);
            if (nativeShell) child.config = config;
            child.layout = this._layout;
            child.hass = this._hass;
            if (nativeShell) child.load();
            child.addEventListener('card-visibility-changed', (event) => {
                event.stopPropagation();
                if (this.child === child) this.setVisible(child.hidden !== true);
            });
            // HA error placeholders request rebuilding when custom cards become available.
            child.addEventListener('ll-rebuild', (event) => {
                event.stopPropagation();
                if (this.child !== child) return;
                this.clearChild();
                this.syncChild();
            }, { once: true });
            this.child = child;
            this.content.replaceChildren(child);
            this.setVisible(child.hidden !== true);
        } catch (error) {
            if (token !== this.token || !this.allowed()) return;
            const message = document.createElement('ha-alert');
            message.alertType = 'error';
            message.textContent = `ACM: unable to load child card: ${error.message}`;
            this.content.replaceChildren(message);
            this.setVisible(true);
        } finally {
            if (token === this.token) this.creating = false;
        }
    }

    getCardSize() { return this.hidden ? 0 : (this.child?.getCardSize?.() ?? 1); }

    getGridOptions() {
        return this.child?.getGridOptions?.() ?? { columns: 12, rows: 'auto' };
    }
}

if (!customElements.get('acm-group-card')) customElements.define('acm-group-card', AcmGroupCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === 'acm-group-card')) {
    window.customCards.push({
        type: 'acm-group-card',
        name: 'ACM Group Card',
        description: 'Show a child card to selected ACM groups. Visibility only, not data security.',
        preview: false,
        documentationURL: 'https://github.com/Darkdragon14/ha-access-control-manager#group-visibility-card',
    });
}
