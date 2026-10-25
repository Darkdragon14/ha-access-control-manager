import assert from 'node:assert/strict';
import { test } from 'node:test';

class Element extends EventTarget {
    constructor() {
        super();
        this.children = [];
        this.isConnected = false;
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    attachShadow() { this.shadowRoot = new Element(); return this.shadowRoot; }
}
const registry = new Map();
globalThis.HTMLElement = Element;
globalThis.customElements = {
    get: (name) => registry.get(name),
    define: (name, value) => registry.set(name, value),
};
globalThis.document = Object.assign(new EventTarget(), {
    documentElement: { lang: 'en' },
    visibilityState: 'visible',
    createElement: (name) => registry.has(name) ? new (registry.get(name))() : new Element(),
});
globalThis.window = { customCards: [] };
const { GroupMembership, membershipFor, validateConfig, AcmGroupCard } = await import(
    '../custom_components/ha_access_control_manager/www/acm-group-card.js'
);
const { translate } = await import('../custom_components/ha_access_control_manager/www/acm-group-card-i18n.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const connection = (request) => Object.assign(new EventTarget(), {
    connected: true,
    sendMessagePromise: request,
});
const config = { type: 'custom:acm-group-card', groups: ['club'], card: { type: 'entities', entities: [] } };

test('configuration validates groups and a single child, without mutating input', () => {
    validateConfig(config);
    for (const bad of [null, {}, { ...config, groups: [] }, { ...config, groups: [' '] },
        { ...config, groups: [1] }, { ...config, card: {} }, { ...config, card: [] }]) {
        assert.throws(() => validateConfig(bad));
    }
    assert.equal(config.card.type, 'entities');
});

test('memberships are shared only for the same connection and identity', () => {
    const a = connection(() => {});
    const b = connection(() => {});
    assert.equal(membershipFor(a, 'one'), membershipFor(a, 'one'));
    assert.notEqual(membershipFor(a, 'one'), membershipFor(a, 'two'));
    assert.notEqual(membershipFor(a, 'one'), membershipFor(b, 'one'));
});

test('initial request is shared, responses contain own groups, cleanup clears cache', async () => {
    let calls = 0;
    const pending = deferred();
    const manager = new GroupMembership(connection((msg) => {
        calls += 1;
        assert.deepEqual(msg, { type: 'ha_access_control/current_user_groups' });
        return pending.promise;
    }));
    const values = [];
    const a = manager.subscribe((groups) => values.push(groups));
    const b = manager.subscribe(() => {});
    try {
        assert.deepEqual(values, [null]);
        manager.refresh();
        await tick();
        assert.equal(calls, 1);
        pending.resolve({ groups: [{ id: 'club', name: 'Club' }] });
        await tick();
        assert.deepEqual(values.at(-1), ['club']);
    } finally { a(); b(); }
    assert.equal(manager.groups, null);
    assert.equal(manager.listeners.size, 0);
});

test('disconnect ignores in-flight replies; ready triggers fresh request', async () => {
    const old = deferred();
    let calls = 0;
    const conn = connection(() => ++calls === 1 ? old.promise : Promise.resolve({ groups: [] }));
    const manager = new GroupMembership(conn);
    const stop = manager.subscribe(() => {});
    try {
        await tick();
        conn.connected = false;
        conn.dispatchEvent(new Event('disconnected'));
        old.resolve({ groups: [{ id: 'club' }] });
        await tick();
        assert.equal(manager.groups, null);
        conn.connected = true;
        conn.dispatchEvent(new Event('ready'));
        await tick();
        assert.equal(calls, 2);
        assert.deepEqual(manager.groups, []);
    } finally { stop(); }
});

test('failed or malformed refresh masks content and later requests recover', async () => {
    let result = { groups: [{ id: 'club' }] };
    const manager = new GroupMembership(connection(() => Promise.resolve(result)));
    const stop = manager.subscribe(() => {});
    try {
        await tick();
        assert.deepEqual(manager.groups, ['club']);
        result = { groups: [null] };
        manager.refresh();
        await tick();
        assert.equal(manager.groups, null);
        result = { groups: [] };
        document.dispatchEvent(new Event('visibilitychange'));
        await tick();
        assert.deepEqual(manager.groups, []);
    } finally { stop(); }
});

test('periodic refresh, timeouts and late replies are bounded', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const pending = deferred();
    let calls = 0;
    const manager = new GroupMembership(connection(() => {
        calls += 1;
        return calls === 1 ? pending.promise : Promise.reject(new Error('offline'));
    }));
    const stop = manager.subscribe(() => {});
    try {
        await tick();
        t.mock.timers.tick(15_001);
        assert.equal(manager.pending, false);
        pending.resolve({ groups: [{ id: 'club' }] });
        await tick();
        assert.equal(manager.groups, null);
        t.mock.timers.tick(45_000);
        await tick();
        assert.equal(calls, 2);
        assert.equal(manager.groups, null);
    } finally { stop(); }
});

test('no child is created until authorized; revoke removes it and emits visibility', async () => {
    const pending = deferred();
    let created = 0;
    window.loadCardHelpers = async () => ({ createCardElement: (received) => {
        created += 1;
        assert.deepEqual(received, config.card);
        return Object.assign(new Element(), {
            getCardSize: () => 5,
            getGridOptions: () => ({ columns: 6, rows: 2 }),
        });
    } });
    const conn = connection(() => pending.promise);
    const card = new AcmGroupCard();
    assert.equal(card.connectedWhileHidden, true, 'native hui-card must keep the empty wrapper mounted');
    card.layout = 'grid';
    const visibility = [];
    card.addEventListener('card-visibility-changed', (event) => visibility.push(event.detail.value));
    card.setConfig(config);
    card.hass = { connection: conn, user: { id: 'u' } };
    assert.equal(created, 0);
    card.isConnected = true;
    card.connectedCallback();
    try {
        await tick();
        assert.equal(created, 0);
        assert.equal(card.hidden, true);
        pending.resolve({ groups: [{ id: 'club' }] });
        await tick();
        assert.equal(created, 1);
        assert.equal(card.hidden, false);
        assert.equal(card.child.hass, card.hass);
        assert.equal(card.child.layout, 'grid');
        card.layout = 'panel';
        assert.equal(card.child.layout, 'panel');
        assert.equal(card.getCardSize(), 5);
        assert.deepEqual(card.getGridOptions(), { columns: 6, rows: 2 });
        membershipFor(conn, 'u').publish([]);
        assert.equal(card.child, null);
        assert.deepEqual(card.content.children, []);
        assert.equal(card.getCardSize(), 0);
        assert.deepEqual(visibility, [false, true, false]);
    } finally { card.isConnected = false; card.disconnectedCallback(); }
});

test('revoked authorization cancels asynchronous helper loading before child creation', async () => {
    const helpers = deferred();
    let created = 0;
    window.loadCardHelpers = () => helpers.promise;
    const conn = connection(async () => ({ groups: [{ id: 'club' }] }));
    const card = new AcmGroupCard();
    card.setConfig(config);
    card.isConnected = true;
    card.hass = { connection: conn, user: { id: 'u' } };
    try {
        await tick();
        membershipFor(conn, 'u').publish([]);
        helpers.resolve({ createCardElement: () => { created += 1; return new Element(); } });
        await tick();
        assert.equal(created, 0);
        assert.equal(card.hidden, true);
    } finally { card.isConnected = false; card.disconnectedCallback(); }
});

test('identity change clears existing content and cannot reuse other identity cache', async () => {
    window.loadCardHelpers = async () => ({ createCardElement: () => new Element() });
    let response = { groups: [{ id: 'club' }] };
    const conn = connection(async () => response);
    const card = new AcmGroupCard();
    card.setConfig(config);
    card.isConnected = true;
    card.hass = { connection: conn, user: { id: 'one' } };
    try {
        await tick();
        assert.equal(card.hidden, false);
        response = { groups: [] };
        card.hass = { connection: conn, user: { id: 'two' } };
        assert.equal(card.hidden, true);
        assert.equal(card.child, null);
        await tick();
        assert.equal(card.hidden, true);
    } finally { card.isConnected = false; card.disconnectedCallback(); }
});

test('config replacement ignores old helper response and invalid config clears child', async () => {
    const old = deferred();
    let requests = 0;
    const children = [];
    window.loadCardHelpers = () => ++requests === 1 ? old.promise : Promise.resolve({
        createCardElement: (cfg) => { children.push(cfg); return new Element(); },
    });
    const card = new AcmGroupCard();
    card.setConfig(config);
    card.isConnected = true;
    card.hass = { connection: connection(async () => ({ groups: [{ id: 'club' }] })), user: { id: 'u' } };
    try {
        await tick();
        card.setConfig({ ...config, card: { type: 'markdown', content: 'new' } });
        await tick();
        old.resolve({ createCardElement: () => { throw new Error('stale helpers used'); } });
        await tick();
        assert.deepEqual(children, [{ type: 'markdown', content: 'new' }]);
        assert.throws(() => card.setConfig({ ...config, groups: [] }));
        assert.equal(card.hidden, true);
        assert.equal(card.child, null);
    } finally { card.isConnected = false; card.disconnectedCallback(); }
});

test('native shell preserves child conditions and its visibility without a grid gap', async () => {
    let loaded = 0;
    class NativeShell extends Element {
        load() { loaded += 1; this.loadedLayout = this.layout; this.hidden = true; }
    }
    registry.set('hui-card', NativeShell);
    window.loadCardHelpers = async () => ({ createCardElement: () => { throw new Error('native shell expected'); } });
    const card = new AcmGroupCard();
    card.layout = 'grid';
    card.setConfig({ ...config, card: { type: 'entities', entities: [], visibility: [{ condition: 'state' }] } });
    card.isConnected = true;
    card.hass = { connection: connection(async () => ({ groups: [{ id: 'club' }] })), user: { id: 'u' } };
    try {
        await tick();
        assert.equal(loaded, 1);
        assert.equal(card.child.loadedLayout, 'grid');
        card.layout = 'panel';
        assert.equal(card.child.layout, 'panel');
        assert.deepEqual(card.child.config, card.config.card);
        assert.equal(card.hidden, true);
        card.child.hidden = false;
        card.child.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: true } }));
        assert.equal(card.hidden, false);
        card.child.hidden = true;
        card.child.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: false } }));
        assert.equal(card.hidden, true);
        assert(card.child, 'a permitted but conditionally hidden child must receive state updates');
    } finally {
        card.isConnected = false;
        card.disconnectedCallback();
        registry.delete('hui-card');
    }
});

test('configuration errors and child-load failures are localized with safe technical detail', async () => {
    assert.throws(() => validateConfig({}, 'fr'), { message: translate('fr', 'invalid_groups') });
    assert.throws(() => validateConfig({ groups: ['club'] }, 'de'), { message: translate('de', 'invalid_card') });
    let loads = 0;
    window.loadCardHelpers = async () => { loads++; throw new Error('<technical error $&>'); };
    const card = new AcmGroupCard();
    card.setConfig(config);
    card.isConnected = true;
    card.hass = { language: 'fr', connection: connection(async () => ({ groups: [{ id: 'club' }] })), user: { id: 'u' } };
    try {
        await tick();
        assert.equal(card.content.children[0].textContent, translate('fr', 'child_error', { error: '<technical error $&>' }));
        card.hass = { ...card.hass, language: 'hu' };
        assert.equal(card.content.children[0].textContent, translate('hu', 'child_error', { error: '<technical error $&>' }));
        assert.equal(loads, 1);
        assert.equal(card.child, null);
        window.loadCardHelpers = async () => ({ createCardElement: () => new Element() });
        membershipFor(card.connection, 'u').publish(['club']);
        await tick();
        assert(card.child);
        card.hass = { ...card.hass, language: 'de' };
        assert.equal(card.content.children[0], card.child, 'a recovered error cannot replace the child on language change');
    } finally { card.isConnected = false; card.disconnectedCallback(); }
});

test('changing language forwards hass but does not recreate an authorized child', async () => {
    let created = 0;
    window.loadCardHelpers = async () => ({ createCardElement: () => { created++; return new Element(); } });
    const card = new AcmGroupCard();
    card.setConfig(config);
    card.isConnected = true;
    card.hass = { language: 'en', connection: connection(async () => ({ groups: [{ id: 'club' }] })), user: { id: 'u' } };
    try {
        await tick();
        const child = card.child;
        card.hass = { ...card.hass, language: 'fr' };
        assert.equal(card.child, child);
        assert.equal(child.hass.language, 'fr');
        assert.equal(created, 1);
    } finally { card.isConnected = false; card.disconnectedCallback(); }
});

test('card catalog metadata follows the document language before hass is assigned', () => {
    const entry = window.customCards.find(card => card.type === 'acm-group-card');
    document.documentElement.lang = 'fr';
    try {
        assert.equal(entry.name, translate('fr', 'card_name'));
        assert.equal(entry.description, translate('fr', 'card_description'));
    } finally { document.documentElement.lang = 'en'; }
});
