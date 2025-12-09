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
            helperTableHeaders: { type: Array },
            helperTableData: { type: Array },
            dataUsers: { type: Array },
            dataGroups: { type: Array },
            isAnUser: { type: Boolean },
            selected: { type: Object },
            needToSetPermissions: { type: Boolean },
            newGroupName: { type: String },
            openCreateGroup: { type: Boolean },
            searchTerm: { type: String },
            _isLoading: { type: Boolean },
            _isSaving: { type: Boolean },
            restartDialogOpen: { type: Boolean }
        };
    }

    constructor() {
        super();
        this.users = [];
        this.tableHeaders = ["name", "read", "write"];
        this.tableHeadersEntities = ["name", "entity_id", "read", "write"];
        this.helperTableHeaders = ["name", "entity_id", "read", "write"];
        this.tableData = [];
        this.helperTableData = [];
        this.dataUsers = [];
        this.dataGroups = [];
        this.isAnUser = false;
        this.needToFetch = true;
        this.selected = {};
        this.needToSetPermissions = false;
        this.newGroupName = '';
        this.openCreateGroup = false;
        this.expandedDevices = new Set();
        this.searchTerm = '';
        this._isLoading = false;
        this._isSaving = false;
        this.searchTimeout = null;
        this.restartDialogOpen = false;
    }

    translate(key) {
        return this.hass.localize(`component.ha_access_control_manager.entity.frontend.${key}.name`);
    }    

    update(changedProperties) {
        if (changedProperties.has('hass') && this.hass && this.needToFetch) {
            this.fetchUsers();
            this.fetchAuths();
            this.fetchDevices();
            this.fetchHelpers();
            this.needToFetch = false;
        }
        super.update(changedProperties);
    }

    fetchUsers() {
        this.hass.callWS({ type: 'ha_access_control/list_users' }).then(users => {
            this.users = users;
        });
    }

    fetchDevices() {
        this.hass.callWS({ type: 'ha_access_control/list_devices' }).then(devices => {
            devices.forEach(device => {
                this.tableData.push({
                    entities: device.entities,
                    name: device.name,
                    id: device.id,
                    read: false,
                    write: false
                });
            })
            // this.requestUpdate();
        });
    }

    fetchHelpers() {
        this.hass.callWS({ type: 'ha_access_control/list_helpers' }).then(helpers => {
            this.helperTableData = helpers.map(helper => ({
                ...helper,
                read: false,
                write: false
            }));

            if (this.selected && !this.isAnUser && this.selected.id) {
                this.loadData(this.selected);
            }
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

            // Add group policies to user, but maybe for for later
            // I need to find a way to differentiate between user and group policies when saving an user
            /*
            user.group_ids.forEach(groupId => {
                console.log(groupId, data.groups);
                const group = data.groups.find(group => group.id === groupId);
                if (group.policy?.entities?.entity_ids) {
                    const keys = Object.keys(group.policy.entities.entity_ids);
                    keys.forEach(entityId => {
                        user.policy.entities.entity_ids[entityId] = group.policy.entities.entity_ids[entityId];
                    });
                }
            });*/
        });

        this.dataUsers = users;
        this.displayCustomGroupWarning();
    }

    changeUser(e) {
        const userId = e.detail.value;
        const user = this.dataUsers.find(user => user.id === userId);
        this.selected = user;
        this.isAnUser = true;
    }

    changeGroup(e) {
        const groupId = e.detail.value;
        const group = this.dataGroups.find(group => group.id === groupId);
        this.selected = group;
        this.isAnUser = false;
        this.loadData(group);
    }

    loadData(data) {
        let allTrueRW = false;
        let allTrueRead = false;
        if (data.id === 'system-users' || data.id === 'system-admin') {
            allTrueRW = true;
        }

        if (data.id === 'system-read-only') {
            allTrueRead = true;
        }

        this.tableData.forEach(device => {
            device.entities.forEach(entity => {
                if (allTrueRW) {
                    entity.read = true;
                    entity.write = true;
                    return;
                }

                if (allTrueRead) {
                    entity.read = true;
                    entity.write = false;
                    return;
                }

                if(data.policy?.entities?.entity_ids[entity.entity_id]) {
                    entity.read = data.policy.entities.entity_ids[entity.entity_id] ? true : false;
                    entity.write = data.policy.entities.entity_ids[entity.entity_id] && typeof data.policy.entities.entity_ids[entity.entity_id] !== 'object' ? true : false;
                } else {
                    entity.read = false;
                    entity.write = false;
                }
            });

            const entityReads = device.entities.map(entity => entity.read);
            const entityWrites = device.entities.map(entity => entity.write);

            device.read = entityReads.every(val => val === true) ? true : entityReads.some(val => val === true) ? "indeterminate" : false;
            device.write = entityWrites.every(val => val === true) ? true : entityWrites.some(val => val === true) ? "indeterminate" : false;

        });
        this.helperTableData = this.helperTableData.map(helper => {
            if (allTrueRW) {
                return { ...helper, read: true, write: true };
            }

            if (allTrueRead) {
                return { ...helper, read: true, write: false };
            }

            if (data.policy?.entities?.entity_ids[helper.entity_id]) {
                const helperPolicy = data.policy.entities.entity_ids[helper.entity_id];
                const read = helperPolicy ? true : false;
                const write = helperPolicy && typeof helperPolicy !== 'object' ? true : false;
                return { ...helper, read, write };
            }

            return { ...helper, read: false, write: false };
        });

        this.tableData = [...this.tableData];
        this.requestUpdate();
    }

    handleCheckboxChange(groupId, checked) {
        if (checked) {
            this.selected.group_ids.push(groupId);
        } else {
            this.selected.group_ids = this.selected.group_ids.filter(id => id !== groupId);
        }  
        
    }

    handleNewGroupSave() {
        const inputField = this.shadowRoot.querySelector('.group-input');
        if (!inputField.reportValidity()) {
            return; 
        }

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
        this.needToSetPermissions = true;
    }
    
    handleNewGroupInput(e) {
        this.newGroupName = e.target.value;
    }

    handleSearchInput(e) {
        this.searchTerm = e.target.value;
        this._isLoading = true;
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this._isLoading = false;
        }, 500);
    }

    get processedTableData() {
        console.log("Processing table data with search term:", this.searchTerm);
        
        const searchTermLower = this.searchTerm ? this.searchTerm.toLowerCase() : null;
    
        if (!searchTermLower) {
            return this.tableData.map(device => ({
                ...device,
                displayEntities: device.entities,
                isExpanded: this.expandedDevices.has(device.id)
            }));
        }
    
        return this.tableData.map(device => {
            const deviceNameMatch = device.name.toLowerCase().includes(searchTermLower);
    
            const matchingEntities = device.entities.filter(entity =>
                (entity.name && entity.name.toLowerCase().includes(searchTermLower)) ||
                (entity.original_name && entity.original_name.toLowerCase().includes(searchTermLower)) ||
                (entity.entity_id && entity.entity_id.toLowerCase().includes(searchTermLower))
            );
    
            if (!deviceNameMatch && matchingEntities.length === 0) {
                return null;
            }
    
            const displayEntities = deviceNameMatch ? device.entities : matchingEntities;
            const autoExpanded = !deviceNameMatch && matchingEntities.length > 0;
            const isExpanded = this.expandedDevices.has(device.id) || autoExpanded;
    
            return {
                ...device,
                displayEntities,
                isExpanded
            };
        }).filter(Boolean);
    }

    displayCustomGroupWarning() {
        this.needToSetPermissions = false;
        this.dataGroups.forEach(group => {
            if (group.id.startsWith('custom-group-')) {
                if (!group.policy || !group.policy.entities || Object.keys(group.policy.entities.entity_ids).length === 0) {
                    this.needToSetPermissions = true;
                }
            }
        })
    }

    getSelectAllState(field) {
        const filteredData = this.processedTableData;
        if (filteredData.length === 0) {
            return false;
        }
        const states = filteredData.map(item => item[field]);
        const allChecked = states.every(val => val === true);
        if (allChecked) return true;
        const someChecked = states.some(val => val === true || val === 'indeterminate');
        if (someChecked) return 'indeterminate';
        return false;
    }

    handleSelectAll(field, event) {
        const isChecked = event.target.checked;
        const filteredData = this.processedTableData;
        
        const filteredIds = new Set(filteredData.map(item => item.id));
        this.tableData.forEach(item => {
            if (filteredIds.has(item.id)) {
                item[field] = isChecked;
                item.entities.forEach(entity => {
                    entity[field] = isChecked;
                });
            }
        });
        this.tableData = [...this.tableData];
        this.requestUpdate();
    }

    getHelperSelectAllState(field) {
        if (!this.helperTableData || this.helperTableData.length === 0) {
            return false;
        }
        const states = this.helperTableData.map(item => item[field]);
        const allChecked = states.every(val => val === true);
        if (allChecked) return true;
        const someChecked = states.some(val => val === true);
        if (someChecked) return 'indeterminate';
        return false;
    }

    handleHelperSelectAll(field, event) {
        const isChecked = event.target.checked;
        this.helperTableData = this.helperTableData.map(helper => ({
            ...helper,
            [field]: isChecked
        }));
        this.requestUpdate();
    }

    updateHelperCheckbox(entityId, field, newState) {
        this.helperTableData = this.helperTableData.map(helper => {
            if (helper.entity_id !== entityId) {
                return helper;
            }
            return { ...helper, [field]: newState };
        });
        this.requestUpdate();
    }

    save() {
        if (this._isSaving) {
            return;
        }
        if (!this.isAnUser) {
            if (!this.selected.policy) {
                this.selected.policy = {
                    entities: {
                        entity_ids: {}
                    }
                };
            }
            
            this.tableData.forEach(device => {
                device.entities.forEach(entity => {
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
            });
            this.helperTableData.forEach(helper => {
                if (helper.read && helper.write) {
                    this.selected.policy.entities.entity_ids[helper.entity_id] = true;
                } else if (helper.read) {
                    this.selected.policy.entities.entity_ids[helper.entity_id] = {
                        read: true
                    };
                } else {
                    delete this.selected.policy.entities.entity_ids[helper.entity_id];
                }
            });
        }
        this._isSaving = true;
        this.requestUpdate();
        this.hass.callWS({ type: 'ha_access_control/set_auths', isAnUser: this.isAnUser, data: this.selected })
            .then(data => {
                this.loadAuths(data);
            })
            .finally(() => {
                this._isSaving = false;
                this.requestUpdate();
            });
    }

    restart() {
        this.restartDialogOpen = true;
    }

    closeRestartDialog() {
        this.restartDialogOpen = false;
    }

    confirmRestart() {
        if (!this.hass) {
            return;
        }
        this.hass.callService('homeassistant', 'restart');
        this.restartDialogOpen = false;
    }

    updateCheckbox(deviceId, field, newState) {
        const device = this.tableData.find(d => d.id === deviceId);
        if (!device) return;

        const searchTermLower = this.searchTerm ? this.searchTerm.toLowerCase() : null;
        let entitiesToUpdate = device.entities;

        if (searchTermLower && !device.name.toLowerCase().includes(searchTermLower)) {
            entitiesToUpdate = device.entities.filter(entity =>
                (entity.name && entity.name.toLowerCase().includes(searchTermLower)) ||
                (entity.original_name && entity.original_name.toLowerCase().includes(searchTermLower)) ||
                (entity.entity_id && entity.entity_id.toLowerCase().includes(searchTermLower))
            );
        }

        entitiesToUpdate.forEach(entity => {
            entity[field] = newState;
        });

        const allEntityStates = device.entities.map(e => e[field]);
        const allChecked = allEntityStates.every(val => val === true);
        const noneChecked = allEntityStates.every(val => val === false);

        if (allChecked) {
            device[field] = true;
        } else if (noneChecked) {
            device[field] = false;
        } else {
            device[field] = 'indeterminate';
        }

        this.tableData = [...this.tableData];
        this.requestUpdate();
    }

    updateEntityCheckbox(deviceId, entityId, field, newState) {
        const device = this.tableData.find(d => d.id === deviceId);
        if (!device) return;
    
        const entity = device.entities.find(e => e.entity_id === entityId);
        if (!entity) return;
    
        entity[field] = newState;
    
        const entityReads = device.entities.map(e => e.read);
        const entityWrites = device.entities.map(e => e.write);
    
        device.read = entityReads.every(val => val === true) ? true : entityReads.some(val => val === true) ? "indeterminate" : false;
        device.write = entityWrites.every(val => val === true) ? true : entityWrites.some(val => val === true) ? "indeterminate" : false;
        this.tableData = [...this.tableData];
        this.requestUpdate();
    }

    toggleEntities(deviceId) {
        if (this.expandedDevices.has(deviceId)) {
            this.expandedDevices.delete(deviceId);
        } else {
            this.expandedDevices.add(deviceId);
        }
        this.requestUpdate();
    }

    render() {
        return html`
        <div>
            <header class="mdc-top-app-bar mdc-top-app-bar--fixed">
                <div class="mdc-top-app-bar__row">
                    <section class="mdc-top-app-bar__section mdc-top-app-bar__section--align-start" id="navigation">
                        <mwc-icon-button class="menu-button"
                            @click=${() => this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }))}
                        >
                            <svg style="width:24px;height:24px" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z" />
                            </svg>
                        </mwc-icon-button>
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

                <ha-card>
                    <div class="card-content">
                        <div class="filters">
                            <ha-combo-box
                            .items=${this.users}
                            .itemLabelPath=${'username'}
                            .itemValuePath=${'id'}
                            .label=${this.translate("user")}
                            @value-changed=${this.changeUser}
                            >
                            </ha-combo-box>
                            <ha-combo-box
                            .items=${this.dataGroups}
                            .itemLabelPath=${'name'}
                            .itemValuePath=${'id'}
                            .label=${this.translate("group")}
                            @value-changed=${this.changeGroup}
                            >
                            </ha-combo-box>

                            <ha-button
                                @click=${this.save}
                                .disabled=${this._isSaving}
                            >
                                ${this.translate("save")}
                            </ha-button>
                            <ha-button
                                class="restart-button"
                                variant="danger"
                                @click=${this.restart}
                                .disabled=${this._isSaving}
                            >
                                ${this.translate("restart")}
                            </ha-button>

                            <ha-textfield
                                class="search-input"
                                label="${this.translate("search_by_name")}"
                                .value=${this.searchTerm}
                                @input=${this.handleSearchInput}
                            ></ha-textfield>
                        </div>
                    </div>
                </ha-card>
                ${this.needToSetPermissions ? html`
                    <div class="container-alert">
                        <ha-alert alert-type="warning">
                            ${this.translate("custom_group_warning")}
                        </ha-alert>
                    </div>
                ` : null}
                ${this.isAnUser ? html`
                    <ha-card class="group-card" header="Groups">
                        <div class="group-list">
                            ${this.dataGroups.map(group => {
                                const isChecked = this.selected.group_ids.includes(group.id);
                                return html`
                                <div class="group-item">
                                    <div class="group-info">
                                        <input
                                            type="checkbox"
                                            ?checked="${isChecked}"
                                            @change="${(e) => this.handleCheckboxChange(group.id, e.target.checked)}"
                                        />
                                        <span class="group-name">${group.name}</span>
                                    </div>
                                </div>`
                            })}
                            <div class="new-group-input">
                                <ha-button
                                    @click=${() => this.openCreateGroup = true}
                                >
                                    ${this.translate("create_new_group")}
                                </ha-button>
                                <ha-button
                                    @click=${this.save}
                                    .disabled=${this._isSaving}
                                >
                                    ${this.translate("save")}
                                </ha-button>
                                <ha-button
                                    class="restart-button"
                                    variant="danger"
                                    @click=${this.restart}
                                    .disabled=${this._isSaving}
                                >
                                    ${this.translate("restart")}
                                </ha-button>
                                <ha-dialog 
                                    .open=${this.openCreateGroup}
                                    heading="${this.translate("create_new_group")}" 
                                >
                                    <div>
                                        <ha-textfield 
                                            class="group-input"
                                            label="${this.translate("group_name")}" 
                                            required
                                            validationMessage="${this.translate("enter_group_name")}"
                                            .value="${this.newGroupName}" 
                                            @input="${this.handleNewGroupInput}"
                                        ></ha-textfield>
                                    </div>
                                    <ha-button
                                        appearance="plain"
                                        dialogAction="save"
                                        slot="primaryAction"
                                        @click="${this.handleNewGroupSave}"
                                    >
                                        ${this.translate("save")}
                                    </ha-button>
                                    <ha-button
                                        appearance="plain"
                                        dialogAction="cancel"
                                        slot="secondaryAction"
                                        @click="${(e) => this.openCreateGroup = false}"
                                    >
                                        ${this.translate("cancel")}
                                    </ha-button>
                                </ha-dialog>
                            </div>
                        </div>
                    </ha-card>`
                : html`
                    <ha-card class="entites-cards" header="${this.translate("device_permissions_for")} ${this.selected?.name || `(${this.translate("select_an_user_or_a_group")})`}">
                        <div class="table-wrapper">
                            ${this._isLoading ? html`                            
                                <div class="spinner-container">
                                    <div class="spinner"></div>
                                </div>
                            ` : html`
                                <table>
                                    <thead>
                                        <tr>
                                            <th></th>
                                            ${this.tableHeaders.map(
                                                (header) => {
                                                    if (header === 'read' || header === 'write') {
                                                        const state = this.getSelectAllState(header);
                                                        return html`<th>
                                                            <mwc-checkbox 
                                                                .checked=${state === true}
                                                                .indeterminate=${state === 'indeterminate'}
                                                                @change=${(e) => this.handleSelectAll(header, e)}
                                                                style="vertical-align: middle; margin-right: 4px;">
                                                            </mwc-checkbox>
                                                            <span style="vertical-align: middle;">${this.translate(header)}</span>
                                                        </th>`
                                                    }
                                                    return html`<th>${this.translate(header)}</th>`
                                                }
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${this.processedTableData.map(
                                        (item) => html`
                                            <tr>
                                                <td>
                                                    <ha-button
                                                        @click=${() => this.toggleEntities(item.id)}
                                                        appearance="plain"
                                                    >
                                                        ${item.isExpanded ? "-" : "+"}
                                                    </ha-button>
                                                </td>
                                                <td>${item[this.tableHeaders[0]]}</td>
                                                <td>
                                                    <mwc-checkbox
                                                        .checked="${item.read === true}"
                                                        .indeterminate="${item.read === 'indeterminate'}"
                                                        @change="${(e) => this.updateCheckbox(item.id, 'read', e.target.checked)}"
                                                    >
                                                </td>
                                                <td>
                                                    <mwc-checkbox
                                                        .checked="${item.write === true}"
                                                        .indeterminate="${item.write === 'indeterminate'}"
                                                        @change="${(e) => this.updateCheckbox(item.id, 'write', e.target.checked)}"
                                                    >
                                                    </mwc-checkbox>
                                                </td>
                                            </tr>
                                            ${item.isExpanded ? html`
                                                <tr>
                                                    <td colspan="4">
                                                    <table>
                                                        <thead>
                                                        <tr>
                                                            ${this.tableHeadersEntities.map(
                                                                (header) => html`<th>${this.translate(header)}</th>`
                                                            )}
                                                        </tr>
                                                        </thead>
                                                        <tbody>
                                                        ${item.displayEntities.length > 0 ? item.displayEntities.map((entity) => html`
                                                            <tr>
                                                            <td>${entity.name === 'Unknown' ?  entity.original_name : entity.name}</td>
                                                            <td>${entity[this.tableHeadersEntities[1]]}</td>
                                                            <td>
                                                                <mwc-checkbox
                                                                    .checked="${entity.read}"
                                                                    @change="${(e) => this.updateEntityCheckbox(item.id, entity.entity_id, 'read', e.target.checked)}"
                                                                >
                                                            </td>
                                                            <td>
                                                                <mwc-checkbox
                                                                    .checked="${entity.write}"
                                                                    @change="${(e) => this.updateEntityCheckbox(item.id, entity.entity_id, 'write', e.target.checked)}"
                                                                >
                                                                </mwc-checkbox>
                                                            </td>
                                                            </tr>
                                                        `) : html`<tr><td colspan="3">${this.translate("entites_not_found")}</td></tr>`}
                                                        </tbody>
                                                    </table>
                                                    </td>
                                                </tr>
                                                ` : ''}
                                        `
                                        )}
                                    </tbody>
                                </table>
                            `}
                        </div>

                        <div class="card-footer">
                            <ha-button
                                @click=${this.save}
                                .disabled=${this._isSaving}
                            >
                                ${this.translate("save")}
                            </ha-button>
                            <ha-button
                                class="restart-button"
                                variant="danger"
                                @click=${this.restart}
                                .disabled=${this._isSaving}
                            >
                                ${this.translate("restart")}
                            </ha-button>
                        </div>
                    </ha-card>`
                }
                ${!this.isAnUser ? html`
                    <ha-card class="helpers-card" header="${this.translate("helper_permissions")} ${this.selected?.name ? `- ${this.selected.name}` : ''}">
                        <div class="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        ${this.helperTableHeaders.map((header) => {
                                            if (header === 'read' || header === 'write') {
                                                const state = this.getHelperSelectAllState(header);
                                                return html`<th>
                                                    <mwc-checkbox 
                                                        .checked=${state === true}
                                                        .indeterminate=${state === 'indeterminate'}
                                                        @change=${(e) => this.handleHelperSelectAll(header, e)}
                                                        style="vertical-align: middle; margin-right: 4px;">
                                                    </mwc-checkbox>
                                                    <span style="vertical-align: middle;">${this.translate(header)}</span>
                                                </th>`
                                            }
                                            return html`<th>${this.translate(header)}</th>`;
                                        })}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${this.helperTableData.length ? this.helperTableData.map(helper => html`
                                        <tr>
                                            <td>${helper.name === 'Unknown' ? helper.entity_id : helper.name}</td>
                                            <td>${helper.entity_id}</td>
                                            <td>
                                                <mwc-checkbox
                                                    .checked="${helper.read}"
                                                    @change="${(e) => this.updateHelperCheckbox(helper.entity_id, 'read', e.target.checked)}"
                                                ></mwc-checkbox>
                                            </td>
                                            <td>
                                                <mwc-checkbox
                                                    .checked="${helper.write}"
                                                    @change="${(e) => this.updateHelperCheckbox(helper.entity_id, 'write', e.target.checked)}"
                                                ></mwc-checkbox>
                                            </td>
                                        </tr>
                                    `) : html`<tr><td colspan="4">${this.translate("helpers_not_found")}</td></tr>`}
                                </tbody>
                            </table>
                        </div>
                        <div class="card-footer">
                            <ha-button
                                @click=${this.save}
                                .disabled=${this._isSaving}
                            >
                                ${this.translate("save")}
                            </ha-button>
                            <ha-button
                                class="restart-button"
                                variant="danger"
                                @click=${this.restart}
                                .disabled=${this._isSaving}
                            >
                                ${this.translate("restart")}
                            </ha-button>
                        </div>
                    </ha-card>
                ` : null}
            </div>
        </div>
        <ha-dialog
            .open=${this.restartDialogOpen}
            heading="${this.translate("confirm_restart_title")}"
            @closed=${this.closeRestartDialog}
        >
            <p>${this.translate("confirm_restart_description")}</p>
            <ha-button
                variant="danger"
                slot="primaryAction"
                @click=${this.confirmRestart}
            >
                ${this.translate("confirm")}
            </ha-button>
            <ha-button
                slot="secondaryAction"
                @click=${this.closeRestartDialog}
            >
                ${this.translate("cancel")}
            </ha-button>
        </ha-dialog>
        `
    }

    static get styles() {
        return css`
            :host {
            }
            .mdc-top-app-bar {
                --mdc-typography-headline6-font-weight: 400;
                background-color: var(--app-header-background-color, var(--primary-color));
                color: var(--app-header-text-color, var(--text-primary-color));
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
            .menu-button {
                display: none;
            }

            /* Affiche le bouton uniquement en dessous de 1024px */
            @media screen and (max-width: 870px) {
                .menu-button {
                display: inline-flex;
                }
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
            input[type="checkbox"] {
                margin-right: 10px;
            }
            .group-input {
                margin-left: 10px;
                margin-right: 10px;
            }

            .search-input {
                margin-left: auto;
            }

            .group-card,
            .entites-cards,
            .helpers-card {
                margin: 10px;
            }
            
            .group-list {
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding: 16px;
            }

            .group-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px;
                border: 1px solid var(--divider-color);
                border-radius: 8px;
                background-color: var(--secondary-background-color);
            }

            .group-info {
                display: flex;
                align-items: center;
            }

            .group-name {
                margin-left: 10px;
                font-size: 16px;
                font-weight: 500;
                color: var(--primary-text-color);
            }

            .group-actions {
                display: flex;
                gap: 8px;
            }

            .new-group-input {
                display: flex;
                gap: 10px;
                align-items: center;
                margin-top: 12px;
            }

            .container-alert {
                margin-top: 15px;
                padding: 0 2%;
            }

            .table-wrapper {
                overflow-x: auto;
                padding: 16px;
            }

            table {
                width: 100%;
                border-collapse: collapse;
                background-color: var(--secondary-background-color);
                border-radius: var(--ha-card-border-radius,12px);
            }

            th {
                text-align: left;
                padding: 12px;
                font-size: 14px;
                font-weight: bold;
                border-bottom: 2px solid var(--divider-color);
                color: var(--primary-text-color);
            }

            td {
                padding: 10px;
                font-size: 14px;
                color: var(--primary-text-color);
                border-bottom: 1px solid var(--divider-color);
            }

            tr:hover {
                background-color: var(--table-row-hover-color, rgba(0, 0, 0, 0.05));
            }

            .card-footer {
                display: flex;
                justify-content: flex-end;
                padding: 16px;
                border-bottom-left-radius: var(--ha-card-border-radius,12px);
                border-bottom-right-radius: var(--ha-card-border-radius,12px);
            }

            ha-button:hover {
                transform: scale(1.05);
                transition: transform 0.2s ease;
            }

            .spinner-container {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 200px;
            }

            .spinner {
                border: 4px solid rgba(0, 0, 0, 0.1);
                width: 36px;
                height: 36px;
                border-radius: 50%;
                border: 4px solid rgba(0, 0, 0, 0.1);
                border-left-color: var(--primary-color);
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                to {
                transform: rotate(360deg);
                }
            }
        `;
    }
}

customElements.define('access-control-manager', AccessControlManager);
