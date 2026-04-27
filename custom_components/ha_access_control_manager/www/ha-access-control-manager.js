const HaLitElement = customElements.get("ha-panel-lovelace")
    || customElements.get("home-assistant-main")
    || customElements.get("ha-sidebar");
const LitElement = window.LitElement || Object.getPrototypeOf(HaLitElement);
const html = window.html || LitElement.prototype.html;
const css = window.css || LitElement.prototype.css;

class AccessControlManager extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            narrow: { type: Boolean },
            route: { type: Object },
            panel: { type: Object },
            users: { type: Array },
            tableData: { type: Array },
            dashboardsData: { type: Array },
            helperTableData: { type: Array },
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
            duplicateGroupDialogOpen: { type: Boolean },
            duplicateGroupName: { type: String },
            groupToDuplicate: { type: Object },
            renameGroupDialogOpen: { type: Boolean },
            renameGroupName: { type: String },
            groupToRename: { type: Object },
            groupToDelete: { type: Object },
            deleteGroupDialogOpen: { type: Boolean },
            deviceFilter: { type: String },
            entityFilter: { type: String },
            helperFilter: { type: String },
            dashboardFilter: { type: String },
            deviceAdvancedFilters: { type: Object },
            entityAdvancedFilters: { type: Object },
            helperAdvancedFilters: { type: Object },
            advancedFilterPanels: { type: Object },
            advancedFilterSections: { type: Object },
            _isSaving: { type: Boolean },
            restartDialogOpen: { type: Boolean },
            dashboardsCollapsed: { type: Boolean },
            devicesCollapsed: { type: Boolean },
            entitiesCollapsed: { type: Boolean },
            helpersCollapsed: { type: Boolean }
        };
    }

    constructor() {
        super();
        this.users = [];
        this.tableData = [];
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
        this.duplicateGroupDialogOpen = false;
        this.duplicateGroupName = '';
        this.groupToDuplicate = null;
        this.renameGroupDialogOpen = false;
        this.renameGroupName = '';
        this.groupToRename = null;
        this.groupToDelete = null;
        this.deleteGroupDialogOpen = false;
        this.deviceFilter = '';
        this.entityFilter = '';
        this.helperFilter = '';
        this.dashboardFilter = '';
        this.deviceAdvancedFilters = {};
        this.entityAdvancedFilters = {};
        this.helperAdvancedFilters = {};
        this.advancedFilterPanels = {};
        this.advancedFilterSections = {};
        this._dashboardsTemplate = [];
        this._pendingDashboardSelection = null;
        this._isSaving = false;
        this.restartDialogOpen = false;
        this.dashboardsCollapsed = true;
        this.devicesCollapsed = true;
        this.entitiesCollapsed = true;
        this.helpersCollapsed = true;
    }

    translate(key) {
        return this.hass.localize(`component.ha_access_control_manager.entity.frontend.${key}.name`);
    }

    resetTableFilters() {
        this.deviceFilter = '';
        this.entityFilter = '';
        this.helperFilter = '';
        this.dashboardFilter = '';
        this.deviceAdvancedFilters = {};
        this.entityAdvancedFilters = {};
        this.helperAdvancedFilters = {};
        this.advancedFilterPanels = {};
        this.advancedFilterSections = {};
    }

    normalizeTableFilterValue(value) {
        if (value === undefined || value === null) {
            return '';
        }

        if (Array.isArray(value)) {
            return value.map(item => this.normalizeTableFilterValue(item)).join(' ');
        }

        return String(value).toLowerCase().trim();
    }

    getTableTriState(values = []) {
        if (values.length === 0) {
            return false;
        }

        const allChecked = values.every(value => value === true);
        if (allChecked) {
            return true;
        }

        const someChecked = values.some(value => value === true || value === 'indeterminate');
        return someChecked ? 'indeterminate' : false;
    }

    getAggregateState(items = [], field) {
        return this.getTableTriState(items.map(item => item[field]));
    }

    filterRowsByValue(rows, columns, filterValue) {
        const normalizedFilter = this.normalizeTableFilterValue(filterValue);
        if (!normalizedFilter) {
            return rows;
        }

        const filterableKeys = Object.entries(columns)
            .filter(([, column]) => column.filterable)
            .map(([key, column]) => column.filterKey || column.valueColumn || key);

        if (filterableKeys.length === 0) {
            return rows;
        }

        return rows.filter(row => filterableKeys.some(key => {
            const value = this.normalizeTableFilterValue(row[key]);
            return value.includes(normalizedFilter);
        }));
    }

    handleTableFilterInput(filterKey, event) {
        this[filterKey] = event.target.value || '';
    }

    getAdvancedFilterProperty(tableType) {
        return {
            devices: 'deviceAdvancedFilters',
            entities: 'entityAdvancedFilters',
            helpers: 'helperAdvancedFilters'
        }[tableType];
    }

    getAdvancedFilters(tableType) {
        const property = this.getAdvancedFilterProperty(tableType);
        return property ? this[property] || {} : {};
    }

    getAdvancedFilterValues(tableType, filterKey) {
        const filters = this.getAdvancedFilters(tableType);
        return Array.isArray(filters[filterKey]) ? filters[filterKey] : [];
    }

    getAdvancedFilterCount(tableType) {
        return Object.values(this.getAdvancedFilters(tableType))
            .reduce((count, values) => count + (Array.isArray(values) ? values.length : 0), 0);
    }

    toggleAdvancedFilterPanel(tableType) {
        this.advancedFilterPanels = {
            ...this.advancedFilterPanels,
            [tableType]: !this.advancedFilterPanels?.[tableType]
        };
    }

    isAdvancedFilterPanelOpen(tableType) {
        return this.advancedFilterPanels?.[tableType] === true;
    }

    clearAdvancedFilters(tableType) {
        const property = this.getAdvancedFilterProperty(tableType);
        if (!property) {
            return;
        }

        this[property] = {};
    }

    getAdvancedFilterSectionKey(tableType, filterKey) {
        return `${tableType}:${filterKey}`;
    }

    isAdvancedFilterSectionExpanded(tableType, filterKey) {
        const sectionKey = this.getAdvancedFilterSectionKey(tableType, filterKey);
        const configuredValue = this.advancedFilterSections?.[sectionKey];
        if (configuredValue !== undefined) {
            return configuredValue;
        }

        return this.getAdvancedFilterValues(tableType, filterKey).length > 0;
    }

    toggleAdvancedFilterSection(tableType, filterKey) {
        const sectionKey = this.getAdvancedFilterSectionKey(tableType, filterKey);
        this.advancedFilterSections = {
            ...this.advancedFilterSections,
            [sectionKey]: !this.isAdvancedFilterSectionExpanded(tableType, filterKey)
        };
    }

    handleAdvancedFilterChange(tableType, filterKey, value, event) {
        this.setAdvancedFilterValue(tableType, filterKey, value, event.target.checked);
    }

    handleAdvancedFilterOptionClick(tableType, filterKey, value, checked, event) {
        const clickedCheckbox = event.composedPath()
            .some(element => element?.localName === 'ha-checkbox' || element instanceof HTMLInputElement);
        if (clickedCheckbox) {
            return;
        }

        this.setAdvancedFilterValue(tableType, filterKey, value, checked);
    }

    setAdvancedFilterValue(tableType, filterKey, value, checked) {
        const property = this.getAdvancedFilterProperty(tableType);
        if (!property) {
            return;
        }

        const filters = { ...(this[property] || {}) };
        const values = new Set(Array.isArray(filters[filterKey]) ? filters[filterKey] : []);

        if (checked) {
            values.add(value);
        } else {
            values.delete(value);
        }

        if (values.size === 0) {
            delete filters[filterKey];
        } else {
            filters[filterKey] = [...values];
        }

        this[property] = filters;
    }

    filterRowsByAdvancedFilters(rows, tableType) {
        const activeFilters = Object.entries(this.getAdvancedFilters(tableType))
            .filter(([, values]) => Array.isArray(values) && values.length > 0);

        if (activeFilters.length === 0) {
            return rows;
        }

        return rows.filter(row => activeFilters.every(([filterKey, values]) => (
            this.rowMatchesAdvancedFilter(row, tableType, filterKey, values)
        )));
    }

    rowMatchesAdvancedFilter(row, tableType, filterKey, selectedValues) {
        if (filterKey === 'permissions') {
            return selectedValues.some(value => this.rowMatchesPermissionFilter(row, value));
        }

        if (filterKey === 'status') {
            return selectedValues.some(value => this.rowMatchesStatusFilter(row, tableType, value));
        }

        const rowValues = this.getRowAdvancedFilterValues(row, filterKey);
        return selectedValues.some(value => rowValues.includes(value));
    }

    rowMatchesPermissionFilter(row, filterValue) {
        switch (filterValue) {
            case 'read_selected':
                return row.read === true || row.read === 'indeterminate';
            case 'write_selected':
                return row.write === true || row.write === 'indeterminate';
            case 'read_only':
                return row.read === true && row.write === false;
            case 'full_access':
                return row.read === true && row.write === true;
            case 'no_access':
                return row.read === false && row.write === false;
            case 'partial_access':
                return row.read === 'indeterminate' || row.write === 'indeterminate';
            default:
                return false;
        }
    }

    rowMatchesStatusFilter(row, tableType, filterValue) {
        switch (filterValue) {
            case 'enabled':
                return !row.disabled_by;
            case 'disabled':
                return Boolean(row.disabled_by);
            case 'visible':
                return tableType === 'devices' ? true : !row.hidden_by;
            case 'hidden':
                return tableType !== 'devices' && Boolean(row.hidden_by);
            default:
                return false;
        }
    }

    getStringFilterValues(value) {
        if (value === undefined || value === null) {
            return [];
        }

        if (Array.isArray(value)) {
            return value.flatMap(item => this.getStringFilterValues(item));
        }

        return String(value)
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    }

    getIntegrationFilterValues(row) {
        if (Array.isArray(row.integration_values) && row.integration_values.length > 0) {
            return row.integration_values;
        }

        return row.integration ? [row.integration] : [];
    }

    getDeviceIntegrationFilterValues(device) {
        if (Array.isArray(device.integrations) && device.integrations.length > 0) {
            return device.integrations
                .map(integration => integration.name)
                .filter(Boolean);
        }

        return device.integration ? [device.integration] : [];
    }

    getRowAdvancedFilterValues(row, filterKey) {
        switch (filterKey) {
            case 'areas':
                return row.area ? [row.area] : ['__none__'];
            case 'integrations':
                return this.getIntegrationFilterValues(row);
            case 'devices':
                return row.device_id ? [row.device_id] : ['__none__'];
            case 'domains':
                return row.domain ? [row.domain] : [];
            case 'labels':
                return (row.labels || []).map(label => label.id || label).filter(Boolean);
            case 'categories':
                return row.category_id ? [row.category_id] : ['__none__'];
            case 'voice_assistants':
                return (row.voice_assistants || []).map(assistant => assistant.id || assistant).filter(Boolean);
            default:
                return [];
        }
    }

    collectFilterOptions(rows, extractor) {
        const options = new Map();

        rows.forEach(row => {
            extractor(row).forEach(option => {
                if (!option?.value || options.has(option.value)) {
                    return;
                }

                options.set(option.value, option);
            });
        });

        return [...options.values()]
            .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' }));
    }

    getPermissionFilterOptions(tableType) {
        const options = [
            { value: 'read_selected', label: this.translate('selected_read') },
            { value: 'write_selected', label: this.translate('selected_write') },
            { value: 'read_only', label: this.translate('read_only') },
            { value: 'full_access', label: this.translate('full_access') },
            { value: 'no_access', label: this.translate('no_access') }
        ];

        if (tableType === 'devices') {
            options.push({ value: 'partial_access', label: this.translate('partial_access') });
        }

        return options;
    }

    getStatusFilterOptions(tableType) {
        const options = [
            { value: 'enabled', label: this.translate('enabled') },
            { value: 'disabled', label: this.translate('disabled') }
        ];

        if (tableType !== 'devices') {
            options.push(
                { value: 'visible', label: this.translate('visible') },
                { value: 'hidden', label: this.translate('hidden') }
            );
        }

        return options;
    }

    getAreaFilterOptions(rows) {
        return this.collectFilterOptions(rows, row => [{
            value: row.area || '__none__',
            label: row.area || this.translate('no_area')
        }]);
    }

    getIntegrationFilterOptions(rows) {
        return this.collectFilterOptions(rows, row => (
            this.getIntegrationFilterValues(row)
                .map(value => ({ value, label: value }))
        ));
    }

    getDeviceFilterOptions(rows) {
        return this.collectFilterOptions(rows, row => [{
            value: row.device_id || '__none__',
            label: row.device_name || this.translate('no_device')
        }]);
    }

    getDomainFilterOptions(rows) {
        return this.collectFilterOptions(rows, row => (
            row.domain ? [{ value: row.domain, label: row.domain }] : []
        ));
    }

    getLabelFilterOptions(rows) {
        return this.collectFilterOptions(rows, row => (
            (row.labels || []).map(label => ({
                value: label.id || label,
                label: label.name || label.id || label
            }))
        ));
    }

    getCategoryFilterOptions(rows) {
        return this.collectFilterOptions(rows, row => [{
            value: row.category_id || '__none__',
            label: row.category_name || this.translate('no_category')
        }]);
    }

    getVoiceAssistantFilterOptions(rows) {
        return this.collectFilterOptions(rows, row => (
            (row.voice_assistants || []).map(assistant => ({
                value: assistant.id || assistant,
                label: assistant.name || assistant.id || assistant
            }))
        ));
    }

    getAdvancedFilterConfig(tableType, rows) {
        const commonSections = [
            {
                key: 'permissions',
                title: this.translate('permissions'),
                options: this.getPermissionFilterOptions(tableType)
            },
            {
                key: 'status',
                title: this.translate('status'),
                options: this.getStatusFilterOptions(tableType)
            }
        ];

        if (tableType === 'devices') {
            return [
                { key: 'areas', title: this.translate('areas'), options: this.getAreaFilterOptions(rows) },
                { key: 'integrations', title: this.translate('integrations'), options: this.getIntegrationFilterOptions(rows) },
                ...commonSections,
                { key: 'labels', title: this.translate('labels'), options: this.getLabelFilterOptions(rows) }
            ];
        }

        if (tableType === 'entities') {
            return [
                { key: 'areas', title: this.translate('areas'), options: this.getAreaFilterOptions(rows) },
                { key: 'devices', title: this.translate('devices'), options: this.getDeviceFilterOptions(rows) },
                { key: 'domains', title: this.translate('domains'), options: this.getDomainFilterOptions(rows) },
                { key: 'integrations', title: this.translate('integrations'), options: this.getIntegrationFilterOptions(rows) },
                ...commonSections,
                { key: 'labels', title: this.translate('labels'), options: this.getLabelFilterOptions(rows) }
            ];
        }

        if (tableType === 'helpers') {
            return [
                { key: 'areas', title: this.translate('areas'), options: this.getAreaFilterOptions(rows) },
                { key: 'devices', title: this.translate('devices'), options: this.getDeviceFilterOptions(rows) },
                { key: 'labels', title: this.translate('labels'), options: this.getLabelFilterOptions(rows) },
                { key: 'categories', title: this.translate('categories'), options: this.getCategoryFilterOptions(rows) },
                { key: 'voice_assistants', title: this.translate('voice_assistants'), options: this.getVoiceAssistantFilterOptions(rows) },
                ...commonSections
            ];
        }

        return [];
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
                    integration: this.getDeviceIntegrationLabel(device),
                    integrations: device.integrations || [],
                    area: this.getDeviceAreaLabel(device),
                    disabled_by: device.disabled_by || null,
                    labels: device.labels || [],
                    read: false,
                    write: false
                }));
            this.filterEntitiesWithoutDevices();

            if (this.selected && !this.isAnUser && this.selected.id) {
                this.loadData(this.selected);
            }
        });
    }

    getDeviceIntegrationLabel(device) {
        if (device.integration) {
            return device.integration;
        }

        const entityPlatforms = [...new Set(
            (device.entities || [])
                .map(entity => entity.platform)
                .filter(Boolean)
        )];

        return entityPlatforms.join(', ');
    }

    getDeviceAreaLabel(device) {
        if (device.area) {
            return device.area;
        }

        return (device.entities || []).find(entity => entity.area)?.area || '';
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
                } else {
                    this.resetSelection();
                }
            } else {
                const updatedGroup = this.dataGroups.find(group => group.id === this.selected.id);
                if (updatedGroup) {
                    this.selected = updatedGroup;
                    this.loadData(updatedGroup);
                    this.loadDashboardPermissions(updatedGroup);
                } else {
                    this.resetSelection();
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
                visibleState = this.getAggregateState(views, 'visible');
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
        this.resetTableFilters();
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
        this.resetTableFilters();
        this.selected = group;
        this.selectedUserId = "";
        this.selectedGroupId = groupId;
        this.isAnUser = false;
        this.loadData(group);
        this.loadDashboardPermissions(group);
    }

    resetSelection() {
        this.resetTableFilters();
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
        this.helperTableData = this.helperTableData.map(helper => ({
            ...helper,
            read: false,
            write: false
        }));
        this.entitiesWithoutDevices = this.entitiesWithoutDevices.map(entity => ({
            ...entity,
            read: false,
            write: false
        }));
        this.loadDashboardPermissions();
        this.tableData = [...this.tableData];
        this.helperTableData = [...this.helperTableData];
        this.entitiesWithoutDevices = [...this.entitiesWithoutDevices];
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

            device.read = this.getAggregateState(device.entities, 'read');
            device.write = this.getAggregateState(device.entities, 'write');

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
                visibleState = this.getAggregateState(clonedViews, 'visible');
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

    openCreateGroupDialog() {
        this.openCreateGroup = true;
    }

    closeCreateGroupDialog() {
        this.openCreateGroup = false;
        this.newGroupName = '';
    }

    handleNewGroupSave() {
        const inputField = this.shadowRoot.querySelector('.group-input');
        if (!inputField.reportValidity()) {
            return; 
        }

        const name = this.newGroupName.trim();
        if (!name) {
            return;
        }

        this._isSaving = true;
        this.requestUpdate();

        this.hass.callWS({ type: 'ha_access_control/create_group', name })
            .then(result => {
                this.closeCreateGroupDialog();
                this.loadAuths(result.data);
            })
            .catch(error => {
                console.error('Unable to create group:', error);
            })
            .finally(() => {
                this._isSaving = false;
                this.requestUpdate();
            });
    }
    
    handleNewGroupInput(e) {
        this.newGroupName = e.target.value;
    }

    getUniqueGroupName(baseName) {
        const normalizedBaseName = (baseName || '').trim();
        if (!normalizedBaseName) {
            return '';
        }

        const existingNames = new Set(
            this.dataGroups
                .map(group => (group.name || '').trim().toLowerCase())
                .filter(name => name)
        );

        if (!existingNames.has(normalizedBaseName.toLowerCase())) {
            return normalizedBaseName;
        }

        let counter = 2;
        let candidate = `${normalizedBaseName} ${counter}`;
        while (existingNames.has(candidate.toLowerCase())) {
            counter += 1;
            candidate = `${normalizedBaseName} ${counter}`;
        }

        return candidate;
    }

    getSuggestedDuplicateGroupName(sourceGroupName) {
        const fallbackGroupName = this.translate("group") || "Group";
        const baseSourceName = (sourceGroupName || fallbackGroupName).trim();
        const copySuffix = this.translate("copy_suffix") || "copy";
        const duplicateBaseName = `${baseSourceName} (${copySuffix})`;
        return this.getUniqueGroupName(duplicateBaseName);
    }

    sanitizeGroupSlug(value) {
        const normalized = (value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/-{2,}/g, '-');

        return normalized || 'group';
    }

    getUniqueGroupId(name) {
        const baseId = `custom-group-${this.sanitizeGroupSlug(name)}`;
        const existingIds = new Set(this.dataGroups.map(group => group.id));

        if (!existingIds.has(baseId)) {
            return baseId;
        }

        let counter = 2;
        let candidate = `${baseId}-${counter}`;
        while (existingIds.has(candidate)) {
            counter += 1;
            candidate = `${baseId}-${counter}`;
        }

        return candidate;
    }

    isDefaultSystemGroup(group) {
        return ['system-admin', 'system-users', 'system-read-only'].includes(group?.id) || group?.system_generated === true;
    }

    openDuplicateGroupDialog(group) {
        if (!group || this.isDefaultSystemGroup(group)) {
            return;
        }

        this.groupToDuplicate = group;
        this.duplicateGroupName = this.getSuggestedDuplicateGroupName(group.name);
        this.duplicateGroupDialogOpen = true;
    }

    closeDuplicateGroupDialog() {
        this.duplicateGroupDialogOpen = false;
        this.duplicateGroupName = '';
        this.groupToDuplicate = null;
    }

    getSelectedGroup() {
        if (this.isAnUser) {
            return null;
        }

        const groupId = this.selectedGroupId || this.selected?.id;
        if (!groupId) {
            return null;
        }

        return this.dataGroups.find(group => group.id === groupId) || null;
    }

    getLinkedUsersForGroup(groupId) {
        if (!groupId || !Array.isArray(this.dataUsers)) {
            return [];
        }

        const usernamesById = new Map(
            (this.users || []).map(user => [user.id, user.username || user.id])
        );

        return this.dataUsers
            .filter(user => user?.id && Array.isArray(user.group_ids) && user.group_ids.includes(groupId))
            .map(user => ({
                id: user.id,
                username: usernamesById.get(user.id) || user.username || user.name || user.id
            }))
            .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
    }

    isGroupDeleteDisabled(group) {
        if (!group) {
            return true;
        }

        return this.getLinkedUsersForGroup(group.id).length > 0 || this._isSaving;
    }

    getDeleteGroupTooltip(group) {
        if (!group) {
            return '';
        }

        if (this.getLinkedUsersForGroup(group.id).length > 0) {
            return this.translate('delete_group_disabled_tooltip');
        }

        return this.translate('delete_group_tooltip');
    }

    openRenameGroupDialog() {
        this.openRenameGroupDialogForGroup(this.getSelectedGroup());
    }

    openRenameGroupDialogForGroup(group) {
        if (!group || this.isDefaultSystemGroup(group) || this._isSaving) {
            return;
        }

        this.groupToRename = group;
        this.renameGroupName = group.name || '';
        this.renameGroupDialogOpen = true;
    }

    closeRenameGroupDialog() {
        this.renameGroupDialogOpen = false;
        this.renameGroupName = '';
        this.groupToRename = null;
    }

    handleRenameGroupInput(e) {
        this.renameGroupName = e.target.value;
    }

    handleRenameGroupSave() {
        const inputField = this.shadowRoot.querySelector('.rename-group-input');
        if (!inputField || !inputField.reportValidity()) {
            return;
        }

        const groupToRename = this.groupToRename || this.getSelectedGroup();
        const newName = this.renameGroupName.trim();
        if (!groupToRename || !newName) {
            return;
        }

        this._isSaving = true;
        this.requestUpdate();

        this.hass.callWS({
            type: 'ha_access_control/rename_group',
            group_id: groupToRename.id,
            new_name: newName
        })
            .then(result => {
                if (!this.isAnUser && (this.selectedGroupId === result.old_group_id || this.selected?.id === result.old_group_id)) {
                    this.selectedGroupId = result.group_id;
                    this.selected = {
                        ...groupToRename,
                        id: result.group_id,
                        name: result.group_name
                    };
                }

                this.closeRenameGroupDialog();
                this.loadAuths(result.data);
            })
            .catch(error => {
                console.error('Unable to rename group:', error);
            })
            .finally(() => {
                this._isSaving = false;
                this.requestUpdate();
            });
    }

    openDeleteGroupDialog() {
        this.openDeleteGroupDialogForGroup(this.getSelectedGroup());
    }

    openDeleteGroupDialogForGroup(group) {
        if (!group || this.isDefaultSystemGroup(group) || this.isGroupDeleteDisabled(group)) {
            return;
        }

        this.groupToDelete = group;
        this.deleteGroupDialogOpen = true;
    }

    closeDeleteGroupDialog() {
        this.groupToDelete = null;
        this.deleteGroupDialogOpen = false;
    }

    handleDeleteGroupConfirm() {
        const groupToDelete = this.groupToDelete || this.getSelectedGroup();
        if (!groupToDelete || this.isDefaultSystemGroup(groupToDelete) || this.isGroupDeleteDisabled(groupToDelete)) {
            this.closeDeleteGroupDialog();
            return;
        }

        this._isSaving = true;
        this.requestUpdate();

        this.hass.callWS({ type: 'ha_access_control/delete_group', group_id: groupToDelete.id })
            .then(result => {
                this.closeDeleteGroupDialog();
                this.loadAuths(result.data);
            })
            .catch(error => {
                console.error('Unable to delete group:', error);
            })
            .finally(() => {
                this._isSaving = false;
                this.requestUpdate();
            });
    }

    renderSelectedGroupActions() {
        const selectedGroup = this.getSelectedGroup();
        if (!selectedGroup || this.isDefaultSystemGroup(selectedGroup)) {
            return null;
        }

        return html`
            <ha-button
                class="group-action-button"
                @click=${this.openRenameGroupDialog}
                .disabled=${this._isSaving}
            >
                ${this.translate('rename_group')}
            </ha-button>
            <span class="delete-group-button-wrapper" title="${this.getDeleteGroupTooltip(selectedGroup)}">
                <ha-button
                    class="group-action-button"
                    variant="danger"
                    .disabled=${this.isGroupDeleteDisabled(selectedGroup)}
                    @click=${this.openDeleteGroupDialog}
                    aria-label="${this.getDeleteGroupTooltip(selectedGroup)}"
                >
                    ${this.translate('delete_group')}
                </ha-button>
            </span>
        `;
    }

    renderGroupMembersCard() {
        const selectedGroup = this.getSelectedGroup();
        if (!selectedGroup) {
            return null;
        }

        const linkedUsers = this.getLinkedUsersForGroup(selectedGroup.id);
        const selectedGroupLabel = selectedGroup.name || selectedGroup.id;

        return html`
            <ha-card
                class="group-users-card"
                header="${this.translate('group_members_for')} ${selectedGroupLabel}"
            >
                <div class="group-users-content">
                    ${linkedUsers.length > 0 ? html`
                        <ul class="group-users-list">
                            ${linkedUsers.map(user => html`
                                <li class="group-users-item">${user.username}</li>
                            `)}
                        </ul>
                    ` : html`
                        <div class="group-users-empty">${this.translate('no_users_linked_to_group')}</div>
                    `}
                </div>
            </ha-card>
        `;
    }

    renderInlineRenameGroupButton(group) {
        if (!group || this.isDefaultSystemGroup(group)) {
            return null;
        }

        return html`
            <ha-button
                class="group-action-button"
                appearance="plain"
                title="${this.translate('rename_group_tooltip')}"
                aria-label="${this.translate('rename_group_tooltip')}"
                @click=${() => this.openRenameGroupDialogForGroup(group)}
                .disabled=${this._isSaving}
            >
                <ha-icon icon="mdi:pencil"></ha-icon>
            </ha-button>
        `;
    }

    renderInlineDeleteGroupButton(group) {
        if (!group || this.isDefaultSystemGroup(group)) {
            return null;
        }

        const tooltip = this.getDeleteGroupTooltip(group);

        return html`
            <span class="delete-group-button-wrapper" title="${tooltip}">
                <ha-button
                    class="group-action-button delete-group-inline-button"
                    appearance="plain"
                    .disabled=${this.isGroupDeleteDisabled(group)}
                    @click=${() => this.openDeleteGroupDialogForGroup(group)}
                    aria-label="${tooltip}"
                >
                    <ha-icon icon="mdi:delete"></ha-icon>
                </ha-button>
            </span>
        `;
    }

    handleDuplicateGroupInput(e) {
        this.duplicateGroupName = e.target.value;
    }

    handleDuplicateGroupSave() {
        const inputField = this.shadowRoot.querySelector('.duplicate-group-input');
        if (!inputField || !inputField.reportValidity()) {
            return;
        }

        if (!this.groupToDuplicate) {
            return;
        }

        const newGroupName = this.duplicateGroupName.trim();
        if (!newGroupName) {
            return;
        }

        const sourceGroupId = this.groupToDuplicate.id;

        this.closeDuplicateGroupDialog();
        this._isSaving = true;
        this.requestUpdate();

        this.hass.callWS({
            type: 'ha_access_control/create_group',
            name: newGroupName,
            source_group_id: sourceGroupId
        })
            .then(result => {
                this.loadAuths(result.data);
            })
            .catch(error => {
                console.error('Unable to duplicate group:', error);
            })
            .finally(() => {
                this._isSaving = false;
                this.requestUpdate();
            });
    }

    get deviceColumns() {
        return {
            name: {
                title: this.translate("name"),
                sortable: true,
                filterable: true,
                flex: 2,
            },
            integration: {
                title: this.translate("integration"),
                sortable: true,
                filterable: true,
                flex: 1.3,
            },
            area: {
                title: this.translate("area"),
                sortable: true,
                filterable: true,
                flex: 1.2,
            },
            read: {
                title: this.translate("read"),
                minWidth: "88px",
                maxWidth: "88px",
                template: (row) => html`
                    <ha-checkbox
                        .checked=${row.read === true}
                        .indeterminate=${row.read === 'indeterminate'}
                        @change=${(event) => this.updateCheckbox(row.id, 'read', event.target.checked)}
                    ></ha-checkbox>
                `,
            },
            write: {
                title: this.translate("write"),
                minWidth: "88px",
                maxWidth: "88px",
                template: (row) => html`
                    <ha-checkbox
                        .checked=${row.write === true}
                        .indeterminate=${row.write === 'indeterminate'}
                        @change=${(event) => this.updateCheckbox(row.id, 'write', event.target.checked)}
                    ></ha-checkbox>
                `,
            },
        };
    }

    get deviceRows() {
        return this.tableData.map(device => ({
            id: device.id,
            name: device.name,
            integration: device.integration || '',
            integration_values: this.getDeviceIntegrationFilterValues(device),
            area: device.area || '',
            disabled_by: device.disabled_by || null,
            labels: device.labels || [],
            read: device.read,
            write: device.write,
        }));
    }

    get entityColumns() {
        return {
            name: {
                title: this.translate("name"),
                sortable: true,
                filterable: true,
                flex: 2,
            },
            original_name: {
                title: "original_name",
                hidden: true,
                filterable: true,
            },
            entity_id: {
                title: this.translate("entity_id"),
                sortable: true,
                filterable: true,
                flex: 2,
            },
            device_name: {
                title: this.translate("device"),
                sortable: true,
                filterable: true,
                flex: 1.5,
            },
            integration: {
                title: this.translate("integration"),
                sortable: true,
                filterable: true,
                flex: 1.3,
            },
            area: {
                title: this.translate("area"),
                sortable: true,
                filterable: true,
                flex: 1.2,
            },
            read: {
                title: this.translate("read"),
                minWidth: "88px",
                maxWidth: "88px",
                template: (row) => html`
                    <ha-checkbox
                        .checked=${row.read === true}
                        @change=${(event) => this.updateEntityRowCheckbox(row, 'read', event.target.checked)}
                    ></ha-checkbox>
                `,
            },
            write: {
                title: this.translate("write"),
                minWidth: "88px",
                maxWidth: "88px",
                template: (row) => html`
                    <ha-checkbox
                        .checked=${row.write === true}
                        @change=${(event) => this.updateEntityRowCheckbox(row, 'write', event.target.checked)}
                    ></ha-checkbox>
                `,
            },
        };
    }

    get entityRows() {
        const entityRows = this.tableData.flatMap(device =>
            device.entities.map(entity => ({
                id: entity.entity_id,
                entity_id: entity.entity_id,
                name: this.getEntityDisplayName(entity),
                original_name: entity.original_name || '',
                device_id: device.id,
                device_name: device.name,
                domain: entity.domain || (entity.entity_id || '').split('.')[0] || '',
                integration: device.integration || entity.platform || '',
                integration_values: this.getDeviceIntegrationFilterValues(device).length > 0
                    ? this.getDeviceIntegrationFilterValues(device)
                    : [entity.platform].filter(Boolean),
                area: entity.area || device.area || '',
                disabled_by: entity.disabled_by || null,
                hidden_by: entity.hidden_by || null,
                labels: entity.labels || [],
                read: entity.read,
                write: entity.write,
            }))
        );

        const withoutDeviceLabel = this.translate("without_device") || 'Without device';
        const orphanRows = (this.entitiesWithoutDevices || []).map(entity => ({
            id: entity.entity_id,
            entity_id: entity.entity_id,
            name: this.getEntityDisplayName(entity),
            original_name: entity.original_name || '',
            device_id: '',
            device_name: withoutDeviceLabel,
            domain: entity.domain || (entity.entity_id || '').split('.')[0] || '',
            integration: entity.platform || '',
            integration_values: [entity.platform].filter(Boolean),
            area: entity.area || '',
            disabled_by: entity.disabled_by || null,
            hidden_by: entity.hidden_by || null,
            labels: entity.labels || [],
            read: entity.read,
            write: entity.write,
        }));

        return [...entityRows, ...orphanRows];
    }

    getEntityDisplayName(entity) {
        return entity.name === 'Unknown'
            ? entity.original_name || entity.entity_id
            : entity.name;
    }

    get helperColumns() {
        return {
            name: {
                title: this.translate("name"),
                sortable: true,
                filterable: true,
                flex: 1.8,
            },
            entity_id: {
                title: this.translate("entity_id"),
                sortable: true,
                filterable: true,
                flex: 2,
            },
            helper_type_label: {
                title: this.translate("type"),
                sortable: true,
                filterable: true,
                flex: 1.2,
            },
            area: {
                title: this.translate("area"),
                sortable: true,
                filterable: true,
                flex: 1.2,
            },
            read: {
                title: this.translate("read"),
                minWidth: "88px",
                maxWidth: "88px",
                template: (row) => html`
                    <ha-checkbox
                        .checked=${row.read === true}
                        @change=${(event) => this.updateHelperCheckbox(row.entity_id, 'read', event.target.checked)}
                    ></ha-checkbox>
                `,
            },
            write: {
                title: this.translate("write"),
                minWidth: "88px",
                maxWidth: "88px",
                template: (row) => html`
                    <ha-checkbox
                        .checked=${row.write === true}
                        @change=${(event) => this.updateHelperCheckbox(row.entity_id, 'write', event.target.checked)}
                    ></ha-checkbox>
                `,
            },
        };
    }

    get helperRows() {
        return (this.helperTableData || []).map(helper => ({
            id: helper.entity_id,
            entity_id: helper.entity_id,
            name: helper.name === 'Unknown' ? helper.entity_id : helper.name,
            helper_type_label: this.formatHelperType(helper.helper_type),
            area: helper.area || '',
            device_id: helper.device_id || '',
            device_name: helper.device_name || '',
            disabled_by: helper.disabled_by || null,
            hidden_by: helper.hidden_by || null,
            labels: helper.labels || [],
            category_id: helper.category_id || '',
            category_name: helper.category_name || '',
            voice_assistants: helper.voice_assistants || [],
            read: helper.read,
            write: helper.write,
        }));
    }

    formatHelperType(helperType) {
        return (helperType || '')
            .split('_')
            .filter(Boolean)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    get dashboardViewColumns() {
        return {
            dashboard_name: {
                title: this.translate("dashboard"),
                sortable: true,
                filterable: true,
                flex: 1.5,
            },
            name: {
                title: this.translate("view"),
                sortable: true,
                filterable: true,
                flex: 1.5,
            },
            path: {
                title: this.translate("path"),
                sortable: true,
                filterable: true,
                flex: 1.2,
            },
            visible: {
                title: this.translate("visible"),
                minWidth: "88px",
                maxWidth: "88px",
                template: (row) => html`
                    <ha-checkbox
                        .checked=${row.visible === true}
                        @change=${(event) => this.updateDashboardViewRowCheckbox(row, event.target.checked)}
                    ></ha-checkbox>
                `,
            },
        };
    }

    get dashboardViewRows() {
        const unknownDashboard = this.translate("unknown_dashboard");
        const entireDashboard = this.translate("entire_dashboard");

        return (this.dashboardsData || []).flatMap(dashboard => {
            const dashboardName = dashboard.name || unknownDashboard;
            const dashboardPath = dashboard.url_path || '';

            if (!dashboard.views || dashboard.views.length === 0) {
                return [{
                    id: `${dashboard.id}__dashboard`,
                    dashboard_id: dashboard.id,
                    view_id: '',
                    dashboard_name: dashboardName,
                    name: entireDashboard,
                    path: dashboardPath,
                    visible: dashboard.visible === true,
                }];
            }

            return dashboard.views.map(view => ({
                id: `${dashboard.id}__${view.id}`,
                dashboard_id: dashboard.id,
                view_id: view.id,
                dashboard_name: dashboardName,
                name: view.name || this.translate("unknown_view"),
                path: view.path || dashboardPath,
                visible: view.visible === true,
            }));
        });
    }

    get filteredDeviceRows() {
        const rows = this.filterRowsByAdvancedFilters(this.deviceRows, 'devices');
        return this.filterRowsByValue(rows, this.deviceColumns, this.deviceFilter);
    }

    get filteredEntityRows() {
        const rows = this.filterRowsByAdvancedFilters(this.entityRows, 'entities');
        return this.filterRowsByValue(rows, this.entityColumns, this.entityFilter);
    }

    get filteredHelperRows() {
        const rows = this.filterRowsByAdvancedFilters(this.helperRows, 'helpers');
        return this.filterRowsByValue(rows, this.helperColumns, this.helperFilter);
    }

    get filteredDashboardViewRows() {
        return this.filterRowsByValue(this.dashboardViewRows, this.dashboardViewColumns, this.dashboardFilter);
    }

    getBulkColumnState(rows, field) {
        return this.getTableTriState(rows.map(row => row[field]));
    }

    handleVisibleDeviceColumnToggle(field, newState) {
        const visibleDeviceIds = new Set(this.filteredDeviceRows.map(row => row.id));
        if (visibleDeviceIds.size === 0) {
            return;
        }

        this.tableData = this.tableData.map(device => {
            if (!visibleDeviceIds.has(device.id)) {
                return device;
            }

            return {
                ...device,
                [field]: newState,
                entities: (device.entities || []).map(entity => ({
                    ...entity,
                    [field]: newState
                }))
            };
        });
        this.requestUpdate();
    }

    handleVisibleEntityColumnToggle(field, newState) {
        const deviceEntitiesById = new Map();
        const orphanEntityIds = new Set();

        this.filteredEntityRows.forEach(row => {
            if (row.device_id) {
                if (!deviceEntitiesById.has(row.device_id)) {
                    deviceEntitiesById.set(row.device_id, new Set());
                }
                deviceEntitiesById.get(row.device_id).add(row.entity_id);
                return;
            }

            orphanEntityIds.add(row.entity_id);
        });

        if (deviceEntitiesById.size === 0 && orphanEntityIds.size === 0) {
            return;
        }

        this.tableData = this.tableData.map(device => {
            const entityIds = deviceEntitiesById.get(device.id);
            if (!entityIds) {
                return device;
            }

            const entities = (device.entities || []).map(entity => {
                if (!entityIds.has(entity.entity_id)) {
                    return entity;
                }

                return {
                    ...entity,
                    [field]: newState
                };
            });

            return {
                ...device,
                entities,
                read: this.getAggregateState(entities, 'read'),
                write: this.getAggregateState(entities, 'write')
            };
        });

        if (orphanEntityIds.size > 0) {
            this.entitiesWithoutDevices = this.entitiesWithoutDevices.map(entity => {
                if (!orphanEntityIds.has(entity.entity_id)) {
                    return entity;
                }

                return {
                    ...entity,
                    [field]: newState
                };
            });
        }

        this.requestUpdate();
    }

    handleVisibleHelperColumnToggle(field, newState) {
        const helperIds = new Set(this.filteredHelperRows.map(row => row.entity_id));
        if (helperIds.size === 0) {
            return;
        }

        this.helperTableData = this.helperTableData.map(helper => {
            if (!helperIds.has(helper.entity_id)) {
                return helper;
            }

            return {
                ...helper,
                [field]: newState
            };
        });
        this.requestUpdate();
    }

    handleVisibleDashboardColumnToggle(field, newState) {
        const dashboardIds = new Set();
        const dashboardViewIds = new Map();

        this.filteredDashboardViewRows.forEach(row => {
            if (row.view_id) {
                if (!dashboardViewIds.has(row.dashboard_id)) {
                    dashboardViewIds.set(row.dashboard_id, new Set());
                }
                dashboardViewIds.get(row.dashboard_id).add(row.view_id);
                return;
            }

            dashboardIds.add(row.dashboard_id);
        });

        if (dashboardIds.size === 0 && dashboardViewIds.size === 0) {
            return;
        }

        this.dashboardsData = this.dashboardsData.map(dashboard => {
            const shouldUpdateDashboard = dashboardIds.has(dashboard.id);
            const viewIds = dashboardViewIds.get(dashboard.id);

            if (!shouldUpdateDashboard && !viewIds) {
                return dashboard;
            }

            if (shouldUpdateDashboard || !(dashboard.views || []).length) {
                return {
                    ...dashboard,
                    [field]: newState,
                    views: (dashboard.views || []).map(view => ({
                        ...view,
                        [field]: newState
                    }))
                };
            }

            const views = (dashboard.views || []).map(view => {
                if (!viewIds.has(view.id)) {
                    return view;
                }

                return {
                    ...view,
                    [field]: newState
                };
            });

            return {
                ...dashboard,
                views,
                [field]: this.getAggregateState(views, field)
            };
        });
        this.requestUpdate();
    }

    updateEntityRowCheckbox(row, field, newState) {
        if (row.device_id) {
            this.updateEntityCheckbox(row.device_id, row.entity_id, field, newState);
            return;
        }

        this.updateEntitiesWithoutDevicesCheckbox(row.entity_id, field, newState);
    }

    updateDashboardViewRowCheckbox(row, newState) {
        if (row.view_id) {
            this.updateViewCheckbox(row.dashboard_id, row.view_id, 'visible', newState);
            return;
        }

        this.updateDashboardCheckbox(row.dashboard_id, 'visible', newState);
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

    updateHelperCheckbox(entityId, field, newState) {
        this.helperTableData = this.helperTableData.map(helper => {
            if (helper.entity_id !== entityId) {
                return helper;
            }
            return { ...helper, [field]: newState };
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

        device.entities.forEach(entity => {
            entity[field] = newState;
        });

        device[field] = this.getAggregateState(device.entities, field);

        this.tableData = [...this.tableData];
        this.requestUpdate();
    }

    updateEntityCheckbox(deviceId, entityId, field, newState) {
        const device = this.tableData.find(d => d.id === deviceId);
        if (!device) return;
    
        const entity = device.entities.find(e => e.entity_id === entityId);
        if (!entity) return;
    
        entity[field] = newState;
    
        device.read = this.getAggregateState(device.entities, 'read');
        device.write = this.getAggregateState(device.entities, 'write');
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

        dashboard[field] = this.getAggregateState(dashboard.views || [], field);

        this.dashboardsData = [...this.dashboardsData];
        this.requestUpdate();
    }

    renderDashboardPermissionsCard() {
        if (this.isAnUser) {
            return null;
        }

        const filteredRows = this.filteredDashboardViewRows;

        return html`
            <ha-card class="dashboards-card collapsible-card" header="${this.translate("dashboard_permissions_for")} ${this.selected?.name || `(${this.translate("select_an_user_or_a_group")})`}">
                <div class="card-toggle-icon" @click=${this.toggleDashboardsCard}>
                    <ha-icon icon="${this.dashboardsCollapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'}"></ha-icon>
                </div>
                ${this.dashboardsCollapsed ? null : html`
                    <div class="data-table-section">
                        <div class="data-table-container dashboard-views-table-container">
                            <ha-data-table
                                class="permissions-data-table"
                                .hass=${this.hass}
                                .id=${'id'}
                                .columns=${this.dashboardViewColumns}
                                .data=${filteredRows}
                                .noDataText=${this.translate("views_not_found")}
                            >
                                ${this.renderDataTableToolbar(
                                    null,
                                    'dashboardFilter',
                                    this.dashboardFilter,
                                    this.translate('search_dashboard_views'),
                                    filteredRows,
                                    ['visible'],
                                    (field, newState) => this.handleVisibleDashboardColumnToggle(field, newState)
                                )}
                            </ha-data-table>
                        </div>
                    </div>
                    ${this.renderPermissionsCardFooter()}
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

    toggleEntitiesCard() {
        this.entitiesCollapsed = !this.entitiesCollapsed;
        this.requestUpdate();
    }

    toggleHelpersCard() {
        this.helpersCollapsed = !this.helpersCollapsed;
        this.requestUpdate();
    }

    renderBulkColumnToggle(field, rows, onToggle) {
        const state = this.getBulkColumnState(rows, field);
        const visibleRowsLabel = this.translate('visible_rows');

        return html`
            <div class="bulk-column-toggle">
                <ha-checkbox
                    aria-label="${this.translate(field)} - ${visibleRowsLabel}"
                    .checked=${state === true}
                    .indeterminate=${state === 'indeterminate'}
                    .disabled=${rows.length === 0 || this._isSaving}
                    @change=${(event) => onToggle(field, event.target.checked)}
                ></ha-checkbox>
                <span>${this.translate(field)}</span>
            </div>
        `;
    }

    renderAdvancedFilterSection(tableType, section) {
        const selectedValues = this.getAdvancedFilterValues(tableType, section.key);
        const expanded = this.isAdvancedFilterSectionExpanded(tableType, section.key);

        return html`
            <div class="advanced-filter-section">
                <button
                    type="button"
                    class="advanced-filter-section-header"
                    @click=${() => this.toggleAdvancedFilterSection(tableType, section.key)}
                >
                    <ha-icon icon="${expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}"></ha-icon>
                    <span>${section.title}</span>
                    ${selectedValues.length > 0 ? html`
                        <span class="advanced-filter-section-count">${selectedValues.length}</span>
                    ` : null}
                </button>
                ${expanded ? html`
                    <div class="advanced-filter-options">
                        ${section.options.length === 0 ? html`
                            <div class="advanced-filter-empty">${this.translate('no_filter_options')}</div>
                        ` : section.options.map(option => {
                            const checked = selectedValues.includes(option.value);

                            return html`
                            <label class="advanced-filter-option">
                                <ha-checkbox
                                    .checked=${checked}
                                    @change=${(event) => this.handleAdvancedFilterChange(tableType, section.key, option.value, event)}
                                ></ha-checkbox>
                                <span
                                    @click=${(event) => this.handleAdvancedFilterOptionClick(tableType, section.key, option.value, !checked, event)}
                                >${option.label}</span>
                            </label>
                            `;
                        })}
                    </div>
                ` : null}
            </div>
        `;
    }

    renderAdvancedFilterPanel(tableType, rows) {
        const sections = this.getAdvancedFilterConfig(tableType, rows);

        return html`
            <div class="advanced-filter-panel">
                ${sections.map(section => this.renderAdvancedFilterSection(tableType, section))}
            </div>
        `;
    }

    renderDataTableToolbar(tableType, filterKey, filterValue, searchLabel, rows, fields, onToggle, allRows = rows) {
        const advancedFilterCount = tableType ? this.getAdvancedFilterCount(tableType) : 0;

        return html`
            <div slot="header" class="data-table-toolbar">
                <ha-textfield
                    class="data-table-search"
                    label="${searchLabel}"
                    .value=${filterValue}
                    @input=${(event) => this.handleTableFilterInput(filterKey, event)}
                ></ha-textfield>
                ${tableType ? html`
                    <div class="advanced-filter-actions">
                        <ha-button
                            class="advanced-filter-button"
                            @click=${() => this.toggleAdvancedFilterPanel(tableType)}
                        >
                            <ha-icon icon="mdi:filter-variant"></ha-icon>
                            ${this.translate('filters')}
                            ${advancedFilterCount > 0 ? html`
                                <span class="advanced-filter-count">${advancedFilterCount}</span>
                            ` : null}
                        </ha-button>
                        ${advancedFilterCount > 0 ? html`
                            <ha-button
                                class="advanced-filter-clear-button"
                                @click=${() => this.clearAdvancedFilters(tableType)}
                            >
                                ${this.translate('clear_filters')}
                            </ha-button>
                        ` : null}
                    </div>
                ` : null}
                <div class="bulk-column-actions" role="group" aria-label="${this.translate('visible_rows')}">
                    ${fields.map(field => this.renderBulkColumnToggle(field, rows, onToggle))}
                </div>
                ${tableType && this.isAdvancedFilterPanelOpen(tableType) ? this.renderAdvancedFilterPanel(tableType, allRows) : null}
            </div>
        `;
    }

    renderPermissionsCardFooter() {
        return html`
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
        `;
    }

    renderDevicesPermissionsCard() {
        if (this.isAnUser) {
            return null;
        }

        const filteredRows = this.filteredDeviceRows;

        return html`
            <ha-card
                class="entites-cards collapsible-card"
                header="${this.translate("device_permissions_for")} ${this.selected?.name || `(${this.translate("select_an_user_or_a_group")})`}"
            >
                <div class="card-toggle-icon" @click=${this.toggleDevicesCard}>
                    <ha-icon icon="${this.devicesCollapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'}"></ha-icon>
                </div>
                ${this.devicesCollapsed ? null : html`
                    <div class="data-table-section">
                        <div class="data-table-container devices-table-container">
                            <ha-data-table
                                class="permissions-data-table"
                                .hass=${this.hass}
                                .id=${'id'}
                                .columns=${this.deviceColumns}
                                .data=${filteredRows}
                                .noDataText=${this.translate("devices_not_found")}
                            >
                                ${this.renderDataTableToolbar(
                                    'devices',
                                    'deviceFilter',
                                    this.deviceFilter,
                                    this.translate('search_devices'),
                                    filteredRows,
                                    ['read', 'write'],
                                    (field, newState) => this.handleVisibleDeviceColumnToggle(field, newState),
                                    this.deviceRows
                                )}
                            </ha-data-table>
                        </div>
                    </div>
                    ${this.renderPermissionsCardFooter()}
                `}
            </ha-card>
        `;
    }

    renderEntitiesPermissionsCard() {
        if (this.isAnUser) {
            return null;
        }

        const filteredRows = this.filteredEntityRows;

        return html`
            <ha-card
                class="entities-card collapsible-card"
                header="${this.translate("entity_permissions_for")} ${this.selected?.name || `(${this.translate("select_an_user_or_a_group")})`}"
            >
                <div class="card-toggle-icon" @click=${this.toggleEntitiesCard}>
                    <ha-icon icon="${this.entitiesCollapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'}"></ha-icon>
                </div>
                ${this.entitiesCollapsed ? null : html`
                    <div class="data-table-section">
                        <div class="data-table-container entities-table-container">
                            <ha-data-table
                                class="permissions-data-table"
                                .hass=${this.hass}
                                .id=${'id'}
                                .columns=${this.entityColumns}
                                .data=${filteredRows}
                                .noDataText=${this.translate("entities_not_found")}
                            >
                                ${this.renderDataTableToolbar(
                                    'entities',
                                    'entityFilter',
                                    this.entityFilter,
                                    this.translate('search_entities'),
                                    filteredRows,
                                    ['read', 'write'],
                                    (field, newState) => this.handleVisibleEntityColumnToggle(field, newState),
                                    this.entityRows
                                )}
                            </ha-data-table>
                        </div>
                    </div>
                    ${this.renderPermissionsCardFooter()}
                `}
            </ha-card>
        `;
    }

    renderHelpersPermissionsCard() {
        if (this.isAnUser) {
            return null;
        }

        const filteredRows = this.filteredHelperRows;

        return html`
            <ha-card
                class="helpers-card collapsible-card"
                header="${this.translate("helper_permissions_for")} ${this.selected?.name || `(${this.translate("select_an_user_or_a_group")})`}"
            >
                <div class="card-toggle-icon" @click=${this.toggleHelpersCard}>
                    <ha-icon icon="${this.helpersCollapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'}"></ha-icon>
                </div>
                ${this.helpersCollapsed ? null : html`
                    <div class="data-table-section">
                        <div class="data-table-container helpers-table-container">
                            <ha-data-table
                                class="permissions-data-table"
                                .hass=${this.hass}
                                .id=${'id'}
                                .columns=${this.helperColumns}
                                .data=${filteredRows}
                                .noDataText=${this.translate("helpers_not_found")}
                            >
                                ${this.renderDataTableToolbar(
                                    'helpers',
                                    'helperFilter',
                                    this.helperFilter,
                                    this.translate('search_helpers'),
                                    filteredRows,
                                    ['read', 'write'],
                                    (field, newState) => this.handleVisibleHelperColumnToggle(field, newState),
                                    this.helperRows
                                )}
                            </ha-data-table>
                        </div>
                    </div>
                    ${this.renderPermissionsCardFooter()}
                `}
            </ha-card>
        `;
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
                            <ha-form
                                .hass=${this.hass}
                                .data=${{ [this.translate("user")]: this.selectedUserId || "" }}
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
                                .data=${{ [this.translate("group")]: this.selectedGroupId || "" }}
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
                            ${this.renderSelectedGroupActions()}
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
                                const isDefaultSystemGroup = this.isDefaultSystemGroup(group);
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
                                    <div class="group-actions">
                                        ${isDefaultSystemGroup ? null : html`
                                            <ha-button
                                                class="duplicate-group-button"
                                                appearance="plain"
                                                title="${this.translate("duplicate_group_tooltip")}" 
                                                aria-label="${this.translate("duplicate_group_tooltip")}" 
                                                @click="${() => this.openDuplicateGroupDialog(group)}"
                                                .disabled=${this._isSaving}
                                            >
                                                <ha-icon icon="mdi:content-copy"></ha-icon>
                                            </ha-button>
                                            ${this.renderInlineRenameGroupButton(group)}
                                            ${this.renderInlineDeleteGroupButton(group)}
                                        `}
                                    </div>
                                </div>`
                            })}
                            <div class="new-group-input">
                                <ha-button
                                    @click=${this.openCreateGroupDialog}
                                    .disabled=${this._isSaving}
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
                                    header-title="${this.translate("create_new_group")}" 
                                    @closed=${this.closeCreateGroupDialog}
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
                                    <ha-dialog-footer slot="footer">
                                        <ha-button
                                            appearance="plain"
                                            dialogAction="cancel"
                                            slot="secondaryAction"
                                            @click=${this.closeCreateGroupDialog}
                                        >
                                            ${this.translate("cancel")}
                                        </ha-button>
                                        <ha-button
                                            appearance="plain"
                                            dialogAction="save"
                                            slot="primaryAction"
                                            @click=${this.handleNewGroupSave}
                                            .disabled=${this._isSaving}
                                        >
                                            ${this.translate("save")}
                                        </ha-button>
                                    </ha-dialog-footer>
                                </ha-dialog>
                                <ha-dialog
                                    .open=${this.duplicateGroupDialogOpen}
                                    header-title="${this.translate("duplicate_group")}" 
                                    @closed=${this.closeDuplicateGroupDialog}
                                >
                                    <div>
                                        <ha-textfield
                                            class="duplicate-group-input"
                                            label="${this.translate("group_name")}" 
                                            required
                                            validationMessage="${this.translate("enter_group_name")}" 
                                            .value="${this.duplicateGroupName}"
                                            @input=${this.handleDuplicateGroupInput}
                                        ></ha-textfield>
                                    </div>
                                    <ha-dialog-footer slot="footer">
                                        <ha-button
                                            appearance="plain"
                                            dialogAction="cancel"
                                            slot="secondaryAction"
                                            @click="${this.closeDuplicateGroupDialog}"
                                        >
                                            ${this.translate("cancel")}
                                        </ha-button>
                                        <ha-button
                                            appearance="plain"
                                            dialogAction="save"
                                            slot="primaryAction"
                                            @click="${this.handleDuplicateGroupSave}"
                                            .disabled=${this._isSaving}
                                        >
                                            ${this.translate("save")}
                                        </ha-button>
                                    </ha-dialog-footer>
                                </ha-dialog>
                            </div>
                        </div>
                    </ha-card>
                    `
                : html`
                    ${this.renderGroupMembersCard()}
                    ${this.renderDashboardPermissionsCard()}
                    ${this.renderDevicesPermissionsCard()}
                    ${this.renderEntitiesPermissionsCard()}
                `}
                ${this.renderHelpersPermissionsCard()}
            </div>
        </div>
        <ha-dialog
            .open=${this.restartDialogOpen}
            header-title="${this.translate("confirm_restart_title")}"
            @closed=${this.closeRestartDialog}
        >
            <p>${this.translate("confirm_restart_description")}</p>
            <ha-dialog-footer slot="footer">
                <ha-button
                    slot="secondaryAction"
                    @click=${this.closeRestartDialog}
                >
                    ${this.translate("cancel")}
                </ha-button>
                <ha-button
                    variant="danger"
                    slot="primaryAction"
                    @click=${this.confirmRestart}
                >
                    ${this.translate("confirm")}
                </ha-button>
            </ha-dialog-footer>
        </ha-dialog>
        <ha-dialog
            .open=${this.renameGroupDialogOpen}
            header-title="${this.translate("rename_group")}"
            @closed=${this.closeRenameGroupDialog}
        >
            <div>
                <ha-textfield
                    class="rename-group-input"
                    label="${this.translate("group_name")}"
                    required
                    validationMessage="${this.translate("enter_group_name")}"
                    .value="${this.renameGroupName}"
                    @input=${this.handleRenameGroupInput}
                ></ha-textfield>
            </div>
            <ha-dialog-footer slot="footer">
                <ha-button
                    appearance="plain"
                    dialogAction="cancel"
                    slot="secondaryAction"
                    @click=${this.closeRenameGroupDialog}
                >
                    ${this.translate("cancel")}
                </ha-button>
                <ha-button
                    appearance="plain"
                    dialogAction="save"
                    slot="primaryAction"
                    @click=${this.handleRenameGroupSave}
                    .disabled=${this._isSaving}
                >
                    ${this.translate("save")}
                </ha-button>
            </ha-dialog-footer>
        </ha-dialog>
        <ha-dialog
            .open=${this.deleteGroupDialogOpen}
            header-title="${this.translate("confirm_delete_group_title")}"
            @closed=${this.closeDeleteGroupDialog}
        >
            <p>${this.translate("confirm_delete_group_description")}</p>
            <ha-dialog-footer slot="footer">
                <ha-button
                    slot="secondaryAction"
                    @click=${this.closeDeleteGroupDialog}
                >
                    ${this.translate("cancel")}
                </ha-button>
                <ha-button
                    variant="danger"
                    slot="primaryAction"
                    @click=${this.handleDeleteGroupConfirm}
                    .disabled=${this._isSaving}
                >
                    ${this.translate("delete_group")}
                </ha-button>
            </ha-dialog-footer>
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

            .group-card,
            .group-users-card,
            .entites-cards,
            .entities-card,
            .dashboards-card,
            .helpers-card,
            .entities-without-devices-card {
                margin: 10px;
            }

            .group-users-content {
                padding: 16px;
            }

            .group-users-list {
                list-style: none;
                margin: 0;
                padding: 0;
                max-height: 180px;
                overflow-y: auto;
            }

            .group-users-item {
                padding: 10px 0;
                color: var(--primary-text-color);
            }

            .group-users-item + .group-users-item {
                border-top: 1px solid var(--divider-color);
            }

            .group-users-empty {
                color: var(--secondary-text-color);
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

            .group-action-button {
                min-width: 0;
            }

            .duplicate-group-button {
                min-width: 0;
            }

            .delete-group-button-wrapper {
                display: inline-flex;
            }

            .duplicate-group-button ha-icon {
                --mdc-icon-size: 18px;
            }

            .group-action-button ha-icon {
                --mdc-icon-size: 18px;
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

            .data-table-section {
                padding: 16px;
            }

            .data-table-toolbar {
                display: flex;
                align-items: flex-end;
                justify-content: space-between;
                gap: 12px;
                padding: 0 0 16px;
                flex-wrap: wrap;
            }

            .data-table-search {
                flex: 1 1 260px;
                min-width: min(100%, 260px);
            }

            .bulk-column-actions {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 10px;
                flex-wrap: wrap;
            }

            .advanced-filter-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }

            .advanced-filter-button ha-icon {
                --mdc-icon-size: 18px;
                margin-right: 6px;
                margin-inline-end: 6px;
                margin-inline-start: initial;
                vertical-align: middle;
            }

            .advanced-filter-count,
            .advanced-filter-section-count {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 18px;
                height: 18px;
                padding: 0 5px;
                margin-left: 6px;
                margin-inline-start: 6px;
                margin-inline-end: initial;
                border-radius: 999px;
                color: var(--text-primary-color);
                background: var(--primary-color);
                font-size: 12px;
                line-height: 18px;
                box-sizing: border-box;
            }

            .advanced-filter-section-count {
                margin-left: auto;
                margin-inline-start: auto;
                margin-inline-end: initial;
            }

            .advanced-filter-panel {
                flex: 1 0 100%;
                width: 100%;
                border: 1px solid var(--divider-color);
                border-radius: var(--ha-card-border-radius, 12px);
                background: var(--card-background-color);
                overflow: hidden;
            }

            .advanced-filter-section + .advanced-filter-section {
                border-top: 1px solid var(--divider-color);
            }

            .advanced-filter-section-header {
                width: 100%;
                min-height: 48px;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 0 14px;
                border: 0;
                color: var(--primary-text-color);
                background: transparent;
                font: inherit;
                font-weight: 500;
                text-align: left;
                cursor: pointer;
            }

            .advanced-filter-section-header ha-icon {
                --mdc-icon-size: 20px;
                color: var(--secondary-text-color);
            }

            .advanced-filter-options {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 4px 12px;
                padding: 0 14px 12px 44px;
                padding-inline-start: 44px;
                padding-inline-end: 14px;
            }

            .advanced-filter-option {
                display: inline-flex;
                align-items: center;
                min-width: 0;
                color: var(--primary-text-color);
                cursor: pointer;
            }

            .advanced-filter-option span {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .advanced-filter-empty {
                color: var(--secondary-text-color);
                font-size: 0.9em;
                padding: 8px 0;
            }

            .bulk-column-toggle {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                color: var(--primary-text-color);
                white-space: nowrap;
            }

            .data-table-container {
                height: min(60vh, 520px);
            }

            .devices-table-container {
                height: min(50vh, 420px);
            }

            .entities-table-container {
                height: min(65vh, 560px);
            }

            .helpers-table-container {
                height: min(55vh, 460px);
            }

            .dashboard-views-table-container {
                height: min(50vh, 420px);
            }

            .permissions-data-table {
                --data-table-border-width: 0;
                height: 100%;
            }

            .collapsible-card {
                position: relative;
            }

            .card-toggle-icon {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 56px;
                display: flex;
                align-items: center;
                justify-content: flex-end;
                padding: 0 16px;
                cursor: pointer;
                z-index: 2;
            }

            .card-toggle-icon ha-icon {
                --mdc-icon-size: 24px;
                pointer-events: none;
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

            @media (max-width: 800px) {
                .data-table-toolbar {
                    align-items: stretch;
                }

                .bulk-column-actions {
                    justify-content: flex-start;
                }

                .advanced-filter-actions {
                    width: 100%;
                    justify-content: flex-start;
                }

                .advanced-filter-options {
                    grid-template-columns: 1fr;
                    padding-left: 40px;
                    padding-inline-start: 40px;
                    padding-inline-end: 12px;
                }

                .devices-table-container {
                    height: 360px;
                }

                .entities-table-container {
                    height: 440px;
                }

                .helpers-table-container,
                .dashboard-views-table-container {
                    height: 360px;
                }
            }
        `;
    }
}

customElements.define('access-control-manager', AccessControlManager);
