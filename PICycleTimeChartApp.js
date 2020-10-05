Ext.define('PICycleTimeChartApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    autoScroll: false,
    requires: ['CycleTimeCalculator'],

    layout: {
        type: 'vbox',
        align: 'stretch'
    },

    items: [{
        id: Utils.AncestorPiAppFilter.RENDER_AREA_ID,
        xtype: 'container',
        layout: {
            type: 'hbox',
            align: 'middle',
            defaultMargins: '0 10 10 0',
        }
    }, {
        id: Utils.AncestorPiAppFilter.PANEL_RENDER_AREA_ID,
        xtype: 'container',
        layout: {
            type: 'hbox',
            align: 'middle',
            defaultMargins: '0 10 10 0',
        }
    }, {
        id: 'chart-area',
        xtype: 'container',
        flex: 1,
        type: 'vbox',
        align: 'stretch'
    }],

    config: {
        defaultSettings: {
            bucketBy: 'quarter',
            piType: '',
            query: ''
        }
    },

    launch: function () {
        this.setLoading(true);
        Rally.data.wsapi.Proxy.superclass.timeout = 240000;
        this.down('#chart-area').on('resize', this.onResize, this);

        if (this.getSetting('piType')) {
            this._loadPIModel(this.getSetting('piType'));
        } else {
            Ext.create('Rally.data.wsapi.Store', {
                model: 'TypeDefinition',
                sorters: [{ property: 'Ordinal' }],
                fetch: ['DisplayName', 'TypePath'],
                filters: [
                    { property: 'Parent.Name', value: 'Portfolio Item' },
                    { property: 'Creatable', value: true }
                ]
            }).load().then({
                success: function (records) {
                    this._loadPIModel(records[0].get('TypePath'));
                },
                scope: this
            });
        }
    },

    _loadPIModel: function (piType) {
        Rally.data.wsapi.ModelFactory.getModel({
            type: piType,
        }).then({
            success: function (model) {
                this.model = model;
                this._addFilters();
            },
            failure: function () {
                this.showError(`Unable to load model type "${piType}". Please verify the settings are configured correctly.`);
            },
            scope: this
        });
    },

    _addFilters: function () {
        this.ancestorFilterPlugin = Ext.create('Utils.AncestorPiAppFilter', {
            ptype: 'UtilsAncestorPiAppFilter',
            pluginId: 'ancestorFilterPlugin',
            visibleTab: this.model.typePath,
            displayMultiLevelFilter: true,
            listeners: {
                scope: this,
                ready: function (plugin) {
                    plugin.addListener({
                        scope: this,
                        select: this._addChart,
                        change: this._addChart
                    });
                    this._addChart();
                },
            }
        });
        this.addPlugin(this.ancestorFilterPlugin);
    },



    _addChart: async function () {
        let chartArea = this.down('#chart-area');
        chartArea.removeAll();
        let context = this.getContext();
        let modelNames = [this.model.typePath];
        let filters = await this._getFilters();
        let gridBoardConfig = {
            xtype: 'rallygridboard',
            toggleState: 'chart',
            chartConfig: this._getChartConfig(),
            context,
            modelNames,
            storeConfig: { filters },
            listeners: {
                scope: this,
                afterrender: function () {
                    this.setLoading(false);
                    this.addExportButton();
                    this.onResize();
                }
            }
        };

        chartArea.add(gridBoardConfig);
    },

    _getChartConfig: function () {
        let context = this.getContext().getDataContext();
        if (this.ancestorFilterPlugin.getIgnoreProjectScope()) {
            context.project = null;
        }

        return {
            xtype: 'rallychart',
            chartColors: ['#937bb7'],
            height: this.down('#chart-area').getHeight() - 20,
            storeType: 'Rally.data.wsapi.Store',
            storeConfig: {
                context,
                limit: 30000,
                fetch: this._getChartFetch(),
                sorters: this._getChartSort(),
                pageSize: 2000,
                model: this.model
            },
            calculatorType: 'CycleTimeCalculator',
            calculatorConfig: {
                bucketBy: this.getSetting('bucketBy'),
            },
            chartConfig: {
                chart: { type: 'column', animation: false },
                legend: { enabled: true },
                title: {
                    text: ''
                },
                yAxis: {
                    min: 0,
                    title: {
                        text: 'Days'
                    }
                },
                plotOptions: {
                    column: {
                        dataLabels: {
                            enabled: false
                        }
                    }
                }
            }
        };
    },

    _getChartFetch: function () {
        return ['ActualStartDate', 'ActualEndDate', 'Release'];
    },

    _getChartSort: function () {
        if (this._isByRelease()) {
            return [{ property: 'Release.ReleaseDate', direction: 'ASC' }];
        } else {
            return [{ property: 'ActualEndDate', direction: 'ASC' }];
        }
    },

    _getFilters: async function () {
        let queries = [{
            property: 'ActualEndDate',
            operator: '!=',
            value: null
        }];

        if (this._isByRelease()) {
            queries.push({
                property: 'Release',
                operator: '!=',
                value: null
            });
        }

        let timeboxScope = this.getContext().getTimeboxScope();
        if (timeboxScope && timeboxScope.isApplicable(this.model) && !this._isByRelease()) {
            queries.push(timeboxScope.getQueryFilter());
        }
        if (this.getSetting('query')) {
            queries.push(Rally.data.QueryFilter.fromQueryString(this.getSetting('query')));
        }

        let multiFilters = await this.ancestorFilterPlugin.getAllFiltersForType(this.model.typePath, true).catch((e) => {
            this.showError(e);
        });

        if (multiFilters) {
            queries = queries.concat(multiFilters);
        }

        return queries;
    },

    _isByRelease: function () {
        return this.getSetting('bucketBy') === 'release';
    },

    onTimeboxScopeChange: function () {
        this.callParent(arguments);

        let gridBoard = this.down('rallygridboard');
        if (gridBoard) {
            gridBoard.destroy();
        }
        this._addChart();
    },

    onResize: function () {
        this.callParent(arguments);
        var gridArea = this.down('#chart-area');
        var gridboard = this.down('rallygridboard');
        if (gridArea && gridboard) {
            gridboard.setHeight(gridArea.getHeight() - 20);
        }
    },

    getSettingsFields: function () {
        return [
            {
                name: 'piType',
                xtype: 'rallycombobox',
                plugins: ['rallyfieldvalidationui'],
                allowBlank: false,
                editable: false,
                autoSelect: false,
                validateOnChange: false,
                validateOnBlur: false,
                fieldLabel: 'Type',
                shouldRespondToScopeChange: true,
                storeConfig: {
                    model: 'TypeDefinition',
                    sorters: [{ property: 'Ordinal' }],
                    fetch: ['DisplayName', 'TypePath'],
                    filters: [
                        { property: 'Parent.Name', value: 'Portfolio Item' },
                        { property: 'Creatable', value: true }
                    ],
                    autoLoad: false,
                    remoteFilter: true,
                    remoteSort: true
                },
                displayField: 'DisplayName',
                valueField: 'TypePath',
                listeners: {
                    change: function (combo) {
                        combo.fireEvent('typeselected', combo.getValue(), combo.context);
                    },
                    ready: function (combo) {
                        combo.fireEvent('typeselected', combo.getValue(), combo.context);
                    }
                },
                bubbleEvents: ['typeselected'],
                readyEvent: 'ready',
                handlesEvents: {
                    projectscopechanged: function (context) {
                        this.refreshWithNewContext(context);
                    }
                }
            },
            {
                name: 'bucketBy',
                xtype: 'rallycombobox',
                plugins: ['rallyfieldvalidationui'],
                fieldLabel: 'Bucket By',
                displayField: 'name',
                valueField: 'value',
                editable: false,
                allowBlank: false,
                store: {
                    fields: ['name', 'value'],
                    data: [
                        { name: 'Month', value: 'month' },
                        { name: 'Quarter', value: 'quarter' },
                        { name: 'Release', value: 'release' },
                        { name: 'Year', value: 'year' }
                    ]
                },
                lastQuery: '',
                handlesEvents: {
                    typeselected: function (type) {
                        Rally.data.ModelFactory.getModel({
                            type: type,
                            success: function (model) {
                                this.store.filterBy(function (record) {
                                    return record.get('value') !== 'release' ||
                                        model.typeDefinition.Ordinal === 0;
                                });
                                if (!this.store.findRecord('value', this.getValue())) {
                                    this.setValue('month');
                                }
                            },
                            scope: this
                        });
                    }
                }
            },
            {
                type: 'query'
            }
        ];
    },

    addExportButton: function () {
        // let ct = this.down('rallyleftright');
        // if (ct && ct.getRight()) {
        //     ct.getRight()
        this.down('#' + Utils.AncestorPiAppFilter.RENDER_AREA_ID).add({
            xtype: 'rallybutton',
            iconCls: 'icon-export',
            cls: 'rly-small secondary export-btn',
            handler: this._export,
            margin: '0 20 7 0',
            scope: this,
            toolTipText: 'Export...'
        });
    },

    _export: function () {
        let chart = this.down('rallychart');
        if (!chart) {
            this.showError('No chart data to export.');
            return;
        }

        let data = chart && chart.getChartData();
        if (!data) {
            this.showError('No chart data to export.');
            return;
        }

        let csv = [];
        let row = [];
        let bucket = this.getSetting('bucketBy');
        let workitems = _.pluck(data.series, 'name');
        let headers = [bucket].concat(workitems);

        csv.push(headers.join(','));
        for (let i = 0; i < data.categories.length; i++) {
            row = [data.categories[i]];
            row.push(data.series[0].data[i][1]);
            if (data.series[1].data[i].length) {
                row.push(`${data.series[1].data[i][0]} - ${data.series[1].data[i][1]}`);
            }
            else {
                row.push('N/A');
            }
            csv.push(row.join(','));
        }

        csv = csv.join('\r\n');
        let fileName = `cycle-time-${Rally.util.DateTime.format(new Date(), 'Y-m-d-h-i-s')}.csv`;
        CATS.workitemThroughput.utils.Toolbox.saveAs(csv, fileName);
    },

    showError(msg, defaultMessage) {
        this.setLoading(false);
        Rally.ui.notify.Notifier.showError({ message: this.parseError(msg, defaultMessage) });
    },

    parseError(e, defaultMessage) {
        defaultMessage = defaultMessage || 'An unknown error has occurred';

        if (typeof e === 'string' && e.length) {
            return e;
        }
        if (e.message && e.message.length) {
            return e.message;
        }
        if (e.exception && e.error && e.error.errors && e.error.errors.length) {
            if (e.error.errors[0].length) {
                return e.error.errors[0];
            } else {
                if (e.error && e.error.response && e.error.response.status) {
                    return `${defaultMessage} (Status ${e.error.response.status})`;
                }
            }
        }
        if (e.exceptions && e.exceptions.length && e.exceptions[0].error) {
            return e.exceptions[0].error.statusText;
        }
        if (e.exception && e.error && typeof e.error.statusText === 'string' && !e.error.statusText.length && e.error.status && e.error.status === 524) {
            return 'The server request has timed out';
        }
        return defaultMessage;
    },

    async wrapPromise(deferred) {
        if (!deferred || !_.isFunction(deferred.then)) {
            return Promise.reject(new Error('Wrap cannot process this type of data into a ECMA promise'));
        }
        return new Promise((resolve, reject) => {
            deferred.then({
                success(...args) {
                    resolve(...args);
                },
                failure(error) {
                    Rally.getApp().setLoading(false);
                    reject(error);
                },
                scope: this
            });
        });
    },

    setLoading(msg) {
        this.down('#chart-area').setLoading(msg);
    }
});
