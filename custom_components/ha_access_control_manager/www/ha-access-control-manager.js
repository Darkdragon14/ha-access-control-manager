import {
    LitElement,
    html,
    css,
} from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";

class AccessControlManager extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            narrow: { type: Boolean },
            route: { type: Object },
            panel: { type: Object },
            users: { type: Array },
            tableHeaders: { type: Array },
            tableData: { type: Array },
            dataUsers: { type: Array },
            dataGroups: { type: Array },
            isAnUser: { type: Boolean },
            selected: { type: Object },
            newGroupName: { type: String }
        };
    }

    constructor() {
        super();
        this.users = [];
        this.tableHeaders = ["entity_id", "name", "read", "write"];
        this.tableData = [];
        this.dataUsers = [];
        this.dataGroups = [];
        this.isAnUser = false;
        this.selected = {};
        this.newGroupName = '';
    }

    update(changedProperties) {
        if (changedProperties.has('hass') && this.hass) {
            this.fetchUsers();
            this.fetchEntities();
            this.fetchAuths();
        }
        super.update(changedProperties);
    }

    fetchUsers() {
        this.hass.callWS({ type: 'ha_access_control/list_users' }).then(users => {
            console.log(users);
            this.users = users;
        });
    }

    fetchEntities() {
        this.hass.callWS({ type: 'ha_access_control/list_entities' }).then(entities => {
            console.log(entities);
            entities.forEach(entity => {
                this.tableData.push({
                    entity_id: entity.entity_id,
                    name: entity.attributes.friendly_name,
                    read: false,
                    write: false
                });
            });
            // this.requestUpdate();
        });
    }

    fetchAuths() {
        this.hass.callWS({ type: 'ha_access_control/list_auths' }).then(data => {
            this.loadAuths(data);
        });
    }

    loadAuths(data) {
        this.dataGroups = data.groups;

        const users = data.users;

        users.forEach(user => {
            if (!user.policy?.entities) {
                user.policy = {
                    entities: {
                        entity_ids: {}
                    }
                }
            }

            user.group_ids.forEach(groupId => {
                console.log(groupId, data.groups);
                const group = data.groups.find(group => group.id === groupId);
                if (group.policy?.entities?.entity_ids) {
                    const keys = Object.keys(group.policy.entities.entity_ids);
                    keys.forEach(entityId => {
                        user.policy.entities.entity_ids[entityId] = group.policy.entities.entity_ids[entityId];
                    });
                }
            });
        });

        
        this.dataUsers = users;
    }

    changeUser(e) {
        const userId = e.detail.value;
        const user = this.dataUsers.find(user => user.id === userId);
        this.selected = user;
        this.isAnUser = true;
        this.loadData(user);
    }

    changeGroup(e) {
        const groupId = e.detail.value;
        const group = this.dataGroups.find(group => group.id === groupId);
        this.selected = group;
        this.isAnUser = false;
        this.loadData(group);
    }

    loadData(data) {
        let allTrue = false;
        if (!data?.policy?.entities?.entity_ids || Object.keys(data.policy.entities.entity_ids).length === 0) {
            allTrue = true;
        }

        this.tableData.forEach(entity => {
            if (allTrue) {
                entity.read = true;
                entity.write = true;
                return;
            }

            entity.read = data.policy.entities.entity_ids[entity.entity_id] ? true : false;
            entity.write = data.policy.entities.entity_ids[entity.entity_id] && typeof data.policy.entities.entity_ids[entity.entity_id] !== 'object' ? true : false;
        });
        console.log(this.tableData);
        
        this.tableData = [...this.tableData];
        this.requestUpdate();
    }

    handleCheckboxChange(groupId, checked) {
        console.log(`Group ID: ${groupId}, Checked: ${checked}`);
    }

    handleNewGroupSave() {
        const name = this.newGroupName.trim();
        if (name) {
            const id = `custom-group-${name.toLowerCase().replaceAll(' ', '-')}`;
            const newGroup = { id, name };
            this.dataGroups = [...this.dataGroups, newGroup];
            this.hass.callWS({ type: 'ha_access_control/set_auths', isAnUser: false, data: newGroup }).then(data => {
                this.loadAuths(data);
            })
            this.newGroupName = '';
        }
    }
    
    handleNewGroupInput(e) {
        this.newGroupName = e.target.value;
    }

    save() {
        this.tableData.forEach(entity => {
            if (entity.read && entity.write) {
                this.selected.policy.entities.entity_ids[entity.entity_id] = true;
            } else if (entity.read) {
                this.selected.policy.entities.entity_ids[entity.entity_id] = {
                    read: true
                };
            } else {
                delete this.selected.policy.entities.entity_ids[entity.entity_id];
            }
        });
        this.hass.callWS({ type: 'ha_access_control/set_auths', isAnUser: this.isAnUser, data: this.selected }).then(data => {
            this.loadAuths(data);
        })
    }

    updateCheckbox(index, field, value) {
        this.tableData[index][field] = !value;
        this.requestUpdate();
    }

    formatHeader(str) {
        return `${str.charAt(0).toUpperCase()}${str.slice(1).replaceAll("_", " ")}`;
    }

    render() {
        return html`
        <div>
            <header class="mdc-top-app-bar mdc-top-app-bar--fixed">
                <div class="mdc-top-app-bar__row">
                    <section class="mdc-top-app-bar__section mdc-top-app-bar__section--align-start" id="navigation">
                        <span class="mdc-top-app-bar__title">
                            ${this.panel.title}
                        </span>
                    </section>
                    <section class="mdc-top-app-bar__section mdc-top-app-bar__section--align-end" id="actions" role="toolbar">
                        <slot name="actionItems"></slot>
                    </section>
                </div>
            </header>
            <div class="mdc-top-app-bar--fixed-adjust flex content">

                <div class="filters">
                    <ha-combo-box
                    .items=${this.users}
                    .itemLabelPath=${'username'}
                    .itemValuePath=${'id'}
                    .label=${'User'}
                    @value-changed=${this.changeUser}
                    >
                    </ha-combo-box>
                    <ha-combo-box
                    .items=${this.dataGroups}
                    .itemLabelPath=${'name'}
                    .itemValuePath=${'id'}
                    .label=${'Group'}
                    @value-changed=${this.changeGroup}
                    >
                    </ha-combo-box>

                    <mwc-button 
                    raised 
                    label="${'Save'}" 
                    @click=${this.save}
                    ></mwc-button>
                </div>
                ${this.isAnUser ? html`
                    <div>
                        <h2>Groups</h2>
                        <ul>
                            ${this.dataGroups.map(group => {
                                const isChecked = this.selected.group_ids.includes(group.id);
                                return html`
                                <li id="${group.id}">
                                    <input
                                        type="checkbox"
                                        ?checked="${isChecked}"
                                        @change="${(e) => this.handleCheckboxChange(group.id, e.target.checked)}"
                                    />
                                    ${group.name}
                                </li>`
                            })}
                            <li id="create-group-li">
                                <input
                                    class="group-input"
                                    type="text"
                                    placeholder="Enter new group name"
                                    .value="${this.newGroupName}"
                                    @input="${this.handleNewGroupInput}"
                                />
                                <button @click="${this.handleNewGroupSave}">Create Group</button>
                            </li>
                        </ul>
                    </div>`
                : null}

                <table>
                    <thead>
                        <tr>
                        ${this.tableHeaders.map(
                            (header) => html`<th>${this.formatHeader(header)}</th>`
                        )}
                        </tr>
                    </thead>
                    <tbody>
                        ${this.tableData.map(
                        (item, index) => html`
                            <tr>
                                <td>${item[this.tableHeaders[0]]}</td>
                                <td>${item[this.tableHeaders[1]]}</td>
                                <td @click=${(e) => this.updateCheckbox(index, 'read', item[this.tableHeaders[2]])}>
                                    ${item[this.tableHeaders[2]] ? 'Yes' : 'No'}
                                </td>
                                <td @click=${(e) => this.updateCheckbox(index, 'write', item[this.tableHeaders[3]])}>
                                    ${item[this.tableHeaders[3]] ? 'Yes' : 'No'}
                                </td>
                            </tr>
                        `
                        )}
                    </tbody>
                </table>
            </div>
        </div>
        `
    }

    static get styles() {
        return css`
            :host {
            }
            .mdc-top-app-bar {
                --mdc-typography-headline6-font-weight: 400;
                color: var(--app-header-text-color,var(--mdc-theme-on-primary,#fff));
                background-color: var(--app-header-background-color,var(--mdc-theme-primary));
                width: var(--mdc-top-app-bar-width,100%);
                display: flex;
                position: fixed;
                flex-direction: column;
                justify-content: space-between;
                box-sizing: border-box;
                width: 100%;
                z-index: 4;
            }
            .mdc-top-app-bar--fixed {
                transition: box-shadow 0.2s linear 0s;
            }
            .mdc-top-app-bar--fixed-adjust {
                padding-top: var(--header-height);
            }
            .mdc-top-app-bar__row {
                height: var(--header-height);
                border-bottom: var(--app-header-border-bottom);
                display: flex;
                position: relative;
                box-sizing: border-box;
                width: 100%;
                height: 64px;
            }
            .mdc-top-app-bar__section--align-start {
                justify-content: flex-start;
                order: -1;
            }
            .mdc-top-app-bar__section {
                display: inline-flex;
                flex: 1 1 auto;
                align-items: center;
                min-width: 0px;
                padding: 8px 12px;
                z-index: 1;
            }
            .mdc-top-app-bar__title {
                -webkit-font-smoothing: antialiased;
                font-family: var(--mdc-typography-headline6-font-family,var(--mdc-typography-font-family,Roboto,sans-serif));
                font-size: var(--mdc-typography-headline6-font-size,1.25rem);
                line-height: var(--mdc-typography-headline6-line-height,2rem);
                font-weight: var(--mdc-typography-headline6-font-weight,500);
                letter-spacing: var(--mdc-typography-headline6-letter-spacing,.0125em);
                text-decoration: var(--mdc-typography-headline6-text-decoration,inherit);
                text-transform: var(--mdc-typography-headline6-text-transform,inherit);
                padding-left: 20px;
                padding-right: 0px;
                text-overflow: ellipsis;
                white-space: nowrap;
                overflow: hidden;
                z-index: 1;
            }
        
            app-header {
                background-color: var(--primary-color);
                color: var(--text-primary-color);
                font-weight: 400;
            }
            app-toolbar {
                height: var(--header-height);
            }
            app-toolbar [main-title] {
                margin-left: 20px
            }

            .filters {
                align-items: center;
                display: flex;
                flex-wrap: wrap;
                padding: 8px 16px 0px;
            }
            .filters > * {
                margin-right: 8px;
            }
            ha-combo-box {
                padding: 8px 0;
                width: auto;
            }
            table {
                width: 90%;
                margin-left: 5%;
                border-collapse: collapse;
                margin-top: 20px;
            }
            th, td {
                border: 1px solid #ddd;
                padding: 8px;
                text-align: left;
            }
            th {
                font-weight: bold;
                border-bottom: 3px solid #ddd;
            }
            ul {
                list-style-type: none;
                padding-left: 0;
            }
            li {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
            }
            input[type="checkbox"] {
                margin-right: 10px;
            }
            .group-input {
                margin-left: 10px;
                margin-right: 10px;
            }
        `;
    }
}

customElements.define('access-control-manager', AccessControlManager);