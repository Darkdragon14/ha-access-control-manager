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
            dashboardsTableHeaders: { type: Array },
            dashboardsData: { type: Array },
            helperTableHeaders: { type: Array },
            helperTableData: { type: Array },
            entitiesWithoutDevicesHeaders: { type: Array },
            entitiesWithoutDevices: { type: Array },
            dataUsers: { type: Array },
            dataGroups: { type: Array },
            isAnUser: { type: Boolean },
            selected: { type: Object },
            selectedUserId: { type: String },
            selectedGroupId: { type: String },
            needToSetPermissions: { type: Boolean },
            newGroupName: { type: String },
            openCreateGroup: { type: Boolean },
            searchTerm: { type: String },
            _isLoading: { type: Boolean },
            _isSaving: { type: Boolean },
            restartDialogOpen: { type: Boolean },
            dashboardsCollapsed: { type: Boolean },
            devicesCollapsed: { type: Boolean },
            helpersCollapsed: { type: Boolean },
            entitiesWithoutDevicesCollapsed: { type: Boolean }
        };
    }

    constructor() {
        super();
        this.users = [];
        this.tableHeaders = ["name", "read", "write"];
        this.tableHeadersEntities = ["name", "entity_id", "read", "write"];
        this.helperTableHeaders = ["name", "entity_id", "read", "write"];
        this.entitiesWithoutDevicesHeaders = ["name", "entity_id", "read", "write"];
        this.tableData = [];
        this.dashboardsTableHeaders = ["name", "visible"];
        this.dashboardsData = [];
        this.helperTableData = [];
        this.entitiesWithoutDevices = [];
        this.dataUsers = [];
        this.dataGroups = [];
        this.isAnUser = false;
        this.needToFetch = true;
        this.selected = {};
        this.selectedUserId = "";
        this.selectedGroupId = "";
        this.needToSetPermissions = false;
        this.newGroupName = '';
        this.openCreateGroup = false;
        this.expandedDevices = new Set();
        this.expandedDashboards = new Set();
        this._dashboardsTemplate = [];
        this._pendingDashboardSelection = null;
        this.searchTerm = '';
        this._isLoading = false;
        this._isSaving = false;
        this.searchTimeout = null;
        this.restartDialogOpen = false;
        this.dashboardsCollapsed = true;
        this.devicesCollapsed = true;
        this.helpersCollapsed = true;
        this.entitiesWithoutDevicesCollapsed = true;
    }

    translate(key) {
        return this.hass.localize(`component.ha_access_control_manager.entity.frontend.${key}.name`);
    }    

    update(changedProperties) {
        if (changedProperties.has('hass') && this.hass && this.needToFetch) {
            this.fetchUsers();
            this.fetchAuths();
            this.fetchDevices();
            this.fetchDashboards();
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
            const withoutDevices = devices.find(device => device.id === 'withoutDevices');
            this.entitiesWithoutDevices = (withoutDevices?.entities || []).map(entity => ({
                ...entity,
                read: false,
                write: false
            }));
            this.tableData = devices
                .filter(device => device.id !== 'withoutDevices')
                .map(device => ({
                    entities: device.entities,
                    name: device.name,
                    id: device.id,
                    read: false,
                    write: false
                }));
            this.filterEntitiesWithoutDevices();

            if (this.selected && !this.isAnUser && this.selected.id) {
                this.loadData(this.selected);
            }
        });
    }

    fetchDashboards() {
        this.hass.callWS({ type: 'ha_access_control/list_dashboards' }).then(dashboards => {
            this.initializeDashboardsData(Array.isArray(dashboards) ? dashboards : []);
        });
    }

    fetchHelpers() {
        this.hass.callWS({ type: 'ha_access_control/list_helpers' }).then(helpers => {
            this.helperTableData = helpers.map(helper => ({
                ...helper,
                read: false,
                write: false
            }));
            this.filterEntitiesWithoutDevices();

            if (this.selected && !this.isAnUser && this.selected.id) {
                this.loadData(this.selected);
            }
        });
    }

    filterEntitiesWithoutDevices() {
        if (!this.entitiesWithoutDevices || this.entitiesWithoutDevices.length === 0) {
            return;
        }
        if (!this.helperTableData || this.helperTableData.length === 0) {
            return;
        }
        const helperIds = new Set(this.helperTableData.map(helper => helper.entity_id));
        this.entitiesWithoutDevices = this.entitiesWithoutDevices.filter(entity => !helperIds.has(entity.entity_id));
    }

    fetchAuths() {
        this.hass.callWS({ type: 'ha_access_control/list_auths' }).then(data => {
            this.loadAuths(data);
        });
    }

    loadAuths(data) {
        const groups = Array.isArray(data.groups) ? data.groups.map(group => ({
            ...group,
            dashboards: group.dashboards || {}
        })) : [];
        groups.forEach(group => {
            if (!group.dashboards) {
                group.dashboards = {};
            }
        });
        this.dataGroups = groups;

        const users = Array.isArray(data.users) ? data.users : [];

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
        
        if (this.selected?.id) {
            if (this.isAnUser) {
                const updatedUser = this.dataUsers.find(user => user.id === this.selected.id);
                if (updatedUser) {
                    this.selected = updatedUser;
                }
            } else {
                const updatedGroup = this.dataGroups.find(group => group.id === this.selected.id);
                if (updatedGroup) {
                    this.selected = updatedGroup;
                    this.loadData(updatedGroup);
                    this.loadDashboardPermissions(updatedGroup);
                }
            }
        }

        this.displayCustomGroupWarning();
    }

    initializeDashboardsData(dashboards = []) {
        if (!Array.isArray(dashboards) || dashboards.length === 0) {
            this._dashboardsTemplate = [];
            this.dashboardsData = [];
            return;
        }

        const preparedDashboards = dashboards.map(dashboard => {
            const views = (dashboard.views || []).map(view => ({
                ...view,
                visible: view.visible ?? false
            }));

            let visibleState = dashboard.visible ?? false;
            if (views.length > 0) {
                const allVisible = views.every(view => view.visible === true);
                const someVisible = views.some(view => view.visible === true);
                if (allVisible) {
                    visibleState = true;
                } else if (someVisible) {
                    visibleState = 'indeterminate';
                } else {
                    visibleState = false;
                }
            }

            return {
                ...dashboard,
                visible: visibleState,
                views
            };
        });

        this._dashboardsTemplate = this.cloneDashboards(preparedDashboards);
        this.dashboardsData = this.cloneDashboards(preparedDashboards);

        if (!this.isAnUser && this.selected?.id) {
            const group = this.dataGroups.find(item => item.id === this.selected.id);
            if (group) {
                this.loadDashboardPermissions(group);
            }
        } else if (this._pendingDashboardSelection) {
            const pendingGroup = this.dataGroups.find(item => item.id === this._pendingDashboardSelection);
            if (pendingGroup) {
                this.loadDashboardPermissions(pendingGroup);
            }
            this._pendingDashboardSelection = null;
        }
    }

    cloneDashboards(dashboards = []) {
        return dashboards.map(dashboard => ({
            ...dashboard,
            views: (dashboard.views || []).map(view => ({ ...view }))
        }));
    }

    changeUser(e) {
        const userId = e.detail.value?.[this.translate("user")];
        if (!userId) {
            this.resetSelection();
            return;
        }
        const user = this.dataUsers.find(user => user.id === userId);
        if (!user) {
            return;
        }
        this.selected = user;
        this.selectedUserId = userId;
        this.selectedGroupId = "";
        this.isAnUser = true;
    }

    changeGroup(e) {
        const groupId = e.detail.value?.[this.translate("group")];
        if (!groupId) {
            this.resetSelection();
            return;
        }
        const group = this.dataGroups.find(group => group.id === groupId);
        if (!group) {
            return;
        }
        this.selected = group;
        this.selectedUserId = "";
        this.selectedGroupId = groupId;
        this.isAnUser = false;
        this.loadData(group);
        this.loadDashboardPermissions(group);
    }

    resetSelection() {
        this.selected = {};
        this.selectedUserId = "";
        this.selectedGroupId = "";
        this.isAnUser = false;
        this.tableData.forEach(device => {
            device.read = false;
            device.write = false;
            device.entities.forEach(entity => {
                entity.read = false;
                entity.write = false;
            });
        });
        this.tableData = [...this.tableData];
        this.requestUpdate();
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

        this.filterEntitiesWithoutDevices();
        this.entitiesWithoutDevices = this.entitiesWithoutDevices.map(entity => {
            if (allTrueRW) {
                return { ...entity, read: true, write: true };
            }

            if (allTrueRead) {
                return { ...entity, read: true, write: false };
            }

            if (data.policy?.entities?.entity_ids[entity.entity_id]) {
                const entityPolicy = data.policy.entities.entity_ids[entity.entity_id];
                const read = entityPolicy ? true : false;
                const write = entityPolicy && typeof entityPolicy !== 'object' ? true : false;
                return { ...entity, read, write };
            }

            return { ...entity, read: false, write: false };
        });

        this.tableData = [...this.tableData];
        this.requestUpdate();
    }

    loadDashboardPermissions(group) {
        if (!group) {
            this.dashboardsData = this.cloneDashboards(this._dashboardsTemplate || []);
            return;
        }

        if (!Array.isArray(this._dashboardsTemplate) || this._dashboardsTemplate.length === 0) {
            this._pendingDashboardSelection = group.id;
            return;
        }

        if (!group.dashboards) {
            group.dashboards = {};
        }

        const dashboardsMap = group.dashboards || {};
        const clonedDashboards = this.cloneDashboards(this._dashboardsTemplate);

        this.dashboardsData = clonedDashboards.map(dashboard => {
            const storedDashboard = dashboardsMap[dashboard.id];
            const clonedViews = (dashboard.views || []).map(view => {
                let viewVisible = false;
                if (storedDashboard && storedDashboard.views && Object.prototype.hasOwnProperty.call(storedDashboard.views, view.id)) {
                    viewVisible = storedDashboard.views[view.id] === true;
                } else if (storedDashboard && storedDashboard.visible === true) {
                    viewVisible = true;
                }

                return {
                    ...view,
                    visible: viewVisible
                };
            });

            let visibleState = false;

            if (clonedViews.length > 0) {
                const allVisible = clonedViews.every(val => val.visible === true);
                const someVisible = clonedViews.some(val => val.visible === true);
                if (allVisible) {
                    visibleState = true;
                } else if (someVisible) {
                    visibleState = 'indeterminate';
                } else {
                    visibleState = false;
                }
            } else if (storedDashboard && storedDashboard.visible === true) {
                visibleState = true;
            }

            return {
                ...dashboard,
                views: clonedViews,
                visible: visibleState
            };
        });

        this._pendingDashboardSelection = null;
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
            const newGroup = { id, name, dashboards: {} };
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

    get dashboardsWithState() {
        return this.dashboardsData.map(dashboard => ({
            ...dashboard,
            views: dashboard.views || [],
            isExpanded: this.expandedDashboards.has(dashboard.id)
        }));
    }

    get processedEntitiesWithoutDevices() {
        const searchTermLower = this.searchTerm ? this.searchTerm.toLowerCase() : null;
        if (!this.entitiesWithoutDevices) {
            return [];
        }

        if (!searchTermLower) {
            return this.entitiesWithoutDevices;
        }

        return this.entitiesWithoutDevices.filter(entity =>
            (entity.name && entity.name.toLowerCase().includes(searchTermLower)) ||
            (entity.original_name && entity.original_name.toLowerCase().includes(searchTermLower)) ||
            (entity.entity_id && entity.entity_id.toLowerCase().includes(searchTermLower))
        );
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

    getDashboardSelectAllState(field) {
        if (this.dashboardsData.length === 0) {
            return false;
        }

        const states = this.dashboardsData.map(item => item[field]);
        const allChecked = states.every(val => val === true);
        if (allChecked) {
            return true;
        }

        const someChecked = states.some(val => val === true || val === 'indeterminate');
        if (someChecked) {
            return 'indeterminate';
        }

        return false;
    }

    handleDashboardSelectAll(field, event) {
        const isChecked = event.target.checked;
        this.dashboardsData.forEach(item => {
            item[field] = isChecked;
            (item.views || []).forEach(view => {
                view[field] = isChecked;
            });
        });
        this.dashboardsData = [...this.dashboardsData];
        this.requestUpdate();
    }

    collectDashboardPermissions() {
        const result = {};

        this.dashboardsData.forEach(dashboard => {
            const entry = {
                visible: dashboard.visible === true,
            };

            if ((dashboard.views || []).length > 0) {
                const viewStates = {};
                dashboard.views.forEach(view => {
                    viewStates[view.id] = view.visible === true;
                });
                entry.views = viewStates;
            }

            result[dashboard.id] = entry;
        });

        return result;
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

    getEntitiesWithoutDevicesSelectAllState(field) {
        const filteredData = this.processedEntitiesWithoutDevices;
        if (!filteredData || filteredData.length === 0) {
            return false;
        }
        const states = filteredData.map(item => item[field]);
        const allChecked = states.every(val => val === true);
        if (allChecked) return true;
        const someChecked = states.some(val => val === true);
        if (someChecked) return 'indeterminate';
        return false;
    }

    handleEntitiesWithoutDevicesSelectAll(field, event) {
        const isChecked = event.target.checked;
        const filteredData = this.processedEntitiesWithoutDevices;
        const filteredIds = new Set(filteredData.map(entity => entity.entity_id));
        this.entitiesWithoutDevices = this.entitiesWithoutDevices.map(entity => {
            if (!filteredIds.has(entity.entity_id)) {
                return entity;
            }
            return { ...entity, [field]: isChecked };
        });
        this.requestUpdate();
    }

    updateEntitiesWithoutDevicesCheckbox(entityId, field, newState) {
        this.entitiesWithoutDevices = this.entitiesWithoutDevices.map(entity => {
            if (entity.entity_id !== entityId) {
                return entity;
            }
            return { ...entity, [field]: newState };
        });
        this.requestUpdate();
    }

    save() {
        if (this._isSaving) {
            return;
        }

        let payload = this.selected;

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
            this.entitiesWithoutDevices.forEach(entity => {
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

            const dashboards = this.collectDashboardPermissions();
            payload = {
                ...this.selected,
                dashboards
            };
        } else {
            payload = this.selected;
        }

        this._isSaving = true;
        this.requestUpdate();
        this.hass.callWS({ type: 'ha_access_control/set_auths', isAnUser: this.isAnUser, data: payload })
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

    updateDashboardCheckbox(dashboardId, field, newState) {
        const dashboard = this.dashboardsData.find(d => d.id === dashboardId);
        if (!dashboard) {
            return;
        }

        dashboard[field] = newState;
        (dashboard.views || []).forEach(view => {
            view[field] = newState;
        });

        this.dashboardsData = [...this.dashboardsData];
        this.requestUpdate();
    }

    updateViewCheckbox(dashboardId, viewId, field, newState) {
        const dashboard = this.dashboardsData.find(d => d.id === dashboardId);
        if (!dashboard) {
            return;
        }

        const view = (dashboard.views || []).find(v => v.id === viewId);
        if (!view) {
            return;
        }

        view[field] = newState;

        const viewStates = (dashboard.views || []).map(v => v[field]);
        const allChecked = viewStates.every(val => val === true);
        const noneChecked = viewStates.every(val => val === false);

        if (allChecked) {
            dashboard[field] = true;
        } else if (noneChecked) {
            dashboard[field] = false;
        } else {
            dashboard[field] = 'indeterminate';
        }

        this.dashboardsData = [...this.dashboardsData];
        this.requestUpdate();
    }

    toggleDashboardViews(dashboardId) {
        if (this.expandedDashboards.has(dashboardId)) {
            this.expandedDashboards.delete(dashboardId);
        } else {
            this.expandedDashboards.add(dashboardId);
        }
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

    renderDashboardPermissionsCard() {
        if (this.isAnUser) {
            return null;
        }

        const selectAllState = this.getDashboardSelectAllState('visible');

        return html`
            <ha-card class="dashboards-card collapsible-card" header="${this.translate("dashboard_permissions_for")} ${this.selected?.name || `(${this.translate("select_an_user_or_a_group")})`}">
                <div class="card-toggle-icon" @click=${this.toggleDashboardsCard}>
                    <ha-icon icon="${this.dashboardsCollapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'}"></ha-icon>
                </div>
                ${this.dashboardsCollapsed ? null : html`
                    <div class="table-wrapper">
                        ${this.dashboardsData.length === 0 ? html`
                            <div class="empty-state">
                                ${this.translate("dashboards_not_found")}
                            </div>
                        ` : html`
                            <table>
                                <thead>
                                    <tr>
                                        <th></th>
                                        <th>${this.translate("name")}</th>
                                        <th>
                                            <mwc-checkbox
                                                .checked=${selectAllState === true}
                                                .indeterminate=${selectAllState === 'indeterminate'}
                                                @change=${(e) => this.handleDashboardSelectAll('visible', e)}
                                                style="vertical-align: middle; margin-right: 4px;">
                                            </mwc-checkbox>
                                            <span style="vertical-align: middle;">${this.translate("visible")}</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${this.dashboardsWithState.map((dashboard) => html`
                                        <tr>
                                            <td>
                                                <ha-button
                                                    @click=${() => this.toggleDashboardViews(dashboard.id)}
                                                    appearance="plain"
                                                >
                                                    ${dashboard.isExpanded ? "-" : "+"}
                                                </ha-button>
                                            </td>
                                            <td>${dashboard.name || this.translate("unknown_dashboard")}</td>
                                            <td>
                                                <mwc-checkbox
                                                    .checked="${dashboard.visible === true}"
                                                    .indeterminate="${dashboard.visible === 'indeterminate'}"
                                                    @change="${(e) => this.updateDashboardCheckbox(dashboard.id, 'visible', e.target.checked)}"
                                                >
                                                </mwc-checkbox>
                                            </td>
                                        </tr>
                                        ${dashboard.isExpanded ? html`
                                            <tr>
                                                <td colspan="3">
                                                    <table>
                                                        <thead>
                                                            <tr>
                                                                <th>${this.translate("name")}</th>
                                                                <th>${this.translate("visible")}</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            ${dashboard.views.length > 0 ? dashboard.views.map((view) => html`
                                                                <tr>
                                                                    <td>${view.name || this.translate("unknown_view")}</td>
                                                                    <td>
                                                                        <mwc-checkbox
                                                                            .checked="${view.visible}"
                                                                            @change="${(e) => this.updateViewCheckbox(dashboard.id, view.id, 'visible', e.target.checked)}"
                                                                        >
                                                                        </mwc-checkbox>
                                                                    </td>
                                                                </tr>
                                                            `) : html`<tr><td colspan="2">${this.translate("views_not_found")}</td></tr>`}
                                                        </tbody>
                                                    </table>
                                                </td>
                                            </tr>
                                        ` : ''}
                                    `)}
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
                `}
            </ha-card>
        `;
    }

    toggleDashboardsCard() {
        this.dashboardsCollapsed = !this.dashboardsCollapsed;
        this.requestUpdate();
    }

    toggleDevicesCard() {
        this.devicesCollapsed = !this.devicesCollapsed;
        this.requestUpdate();
    }

    toggleEntitiesWithoutDevicesCard() {
        this.entitiesWithoutDevicesCollapsed = !this.entitiesWithoutDevicesCollapsed;
        this.requestUpdate();
    }

    toggleHelpersCard() {
        this.helpersCollapsed = !this.helpersCollapsed;
        this.requestUpdate();
    }

    render() {
        const entitiesWithoutDevicesTitle = this.translate("entities_without_devices_permissions_for") || "Entities without devices permissions for";
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
                            <ha-form
                                .hass=${this.hass}
                                .schema=${[
                                    {
                                        name: this.translate("user"),
                                        selector: {
                                            select: {
                                                mode: "dropdown",
                                                options: this.users.map(user => ({
                                                    label: user.username,
                                                    value: user.id
                                                })),
                                            },
                                        },
                                    },
                                ]}
                                @value-changed=${this.changeUser}
                            ></ha-form>
                            <ha-form
                                .hass=${this.hass}
                                .schema=${[
                                    {
                                        name: this.translate("group"),
                                        selector: {
                                            select: {
                                                mode: "dropdown",
                                                options: this.dataGroups.map(group => ({
                                                    value: group.id,
                                                    label: group.name
                                                }))
                                            },
                                        },
                                    },
                                ]}
                                @value-changed=${this.changeGroup}
                            ></ha-form>

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
                    </ha-card>
                    `
                : html`
                    ${this.renderDashboardPermissionsCard()}
                    <ha-card
                        class="entites-cards collapsible-card"
                        header="${this.translate("device_permissions_for")} ${this.selected?.name || `(${this.translate("select_an_user_or_a_group")})`}"
                    >
                        <div class="card-toggle-icon" @click=${this.toggleDevicesCard}>
                            <ha-icon icon="${this.devicesCollapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'}"></ha-icon>
                        </div>
                        ${this.devicesCollapsed ? null : html`
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
                        `}
                    </ha-card>`
                }
                ${!this.isAnUser ? html`
                    <ha-card
                        class="helpers-card collapsible-card"
                        header="${this.translate("helper_permissions_for")} ${this.selected?.name || `(${this.translate("select_an_user_or_a_group")})`}"
                    >
                        <div class="card-toggle-icon" @click=${this.toggleHelpersCard}>
                            <ha-icon icon="${this.helpersCollapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'}"></ha-icon>
                        </div>
                        ${this.helpersCollapsed ? null : html`
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
                        `}
                    </ha-card>
                ` : null}
                ${!this.isAnUser ? html`
                    <ha-card
                        class="entities-without-devices-card collapsible-card"
                        header="${entitiesWithoutDevicesTitle} ${this.selected?.name || `(${this.translate("select_an_user_or_a_group")})`}"
                    >
                        <div class="card-toggle-icon" @click=${this.toggleEntitiesWithoutDevicesCard}>
                            <ha-icon icon="${this.entitiesWithoutDevicesCollapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'}"></ha-icon>
                        </div>
                        ${this.entitiesWithoutDevicesCollapsed ? null : html`
                            <div class="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            ${this.entitiesWithoutDevicesHeaders.map((header) => {
                                                if (header === 'read' || header === 'write') {
                                                    const state = this.getEntitiesWithoutDevicesSelectAllState(header);
                                                    return html`<th>
                                                        <mwc-checkbox
                                                            .checked=${state === true}
                                                            .indeterminate=${state === 'indeterminate'}
                                                            @change=${(e) => this.handleEntitiesWithoutDevicesSelectAll(header, e)}
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
                                        ${this.processedEntitiesWithoutDevices.length ? this.processedEntitiesWithoutDevices.map(entity => html`
                                            <tr>
                                                <td>${entity.name === 'Unknown' ? (entity.original_name || entity.entity_id) : entity.name}</td>
                                                <td>${entity.entity_id}</td>
                                                <td>
                                                    <mwc-checkbox
                                                        .checked="${entity.read}"
                                                        @change="${(e) => this.updateEntitiesWithoutDevicesCheckbox(entity.entity_id, 'read', e.target.checked)}"
                                                    ></mwc-checkbox>
                                                </td>
                                                <td>
                                                    <mwc-checkbox
                                                        .checked="${entity.write}"
                                                        @change="${(e) => this.updateEntitiesWithoutDevicesCheckbox(entity.entity_id, 'write', e.target.checked)}"
                                                    ></mwc-checkbox>
                                                </td>
                                            </tr>
                                        `) : html`<tr><td colspan="4">${this.translate("entities_not_found")}</td></tr>`}
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
                        `}
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
            ha-form {
                padding: 8px 0;
                min-width: 200px;
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
            .dashboards-card,
            .helpers-card,
            .entities-without-devices-card {
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

            .collapsible-card {
                position: relative;
            }

            .card-toggle-icon {
                position: absolute;
                top: 16px;
                right: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }

            .card-toggle-icon ha-icon {
                --mdc-icon-size: 24px;
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
                gap: 8px;
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

            .empty-state {
                padding: 24px;
                text-align: center;
                color: var(--secondary-text-color);
            }
        `;
    }
}

customElements.define('access-control-manager', AccessControlManager);
