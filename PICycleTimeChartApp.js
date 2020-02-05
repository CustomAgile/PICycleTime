Ext.define('PICycleTimeChartApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    layout: 'fit',
    autoScroll: false,

    requires: [
        'CycleTimeCalculator'
    ],

    config: {
        defaultSettings: {
            bucketBy: 'quarter',
            piType: '',
            query: ''
        }
    },

    launch: function () {
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
                this._addChart();
            },
            failure: function () {
                Rally.ui.notify.Notifier.showError({
                    message: 'Unable to load model type "' +
                        piType + '". Please verify the settings are configured correctly.'
                });
            },
            scope: this
        });
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

    _addChart: function () {
        var context = this.getContext(),
            whiteListFields = ['Milestones', 'Tags', 'c_EnterpriseApprovalEA'],
            modelNames = [this.model.typePath],
            gridBoardConfig = {
                xtype: 'rallygridboard',
                toggleState: 'chart',
                chartConfig: this._getChartConfig(),
                plugins: [{
                    ptype: 'rallygridboardinlinefiltercontrol',
                    showInChartMode: true,
                    inlineFilterButtonConfig: {
                        stateful: true,
                        stateId: context.getScopedStateId('filters'),
                        filterChildren: false,
                        modelNames: modelNames,
                        inlineFilterPanelConfig: {
                            quickFilterPanelConfig: {
                                defaultFields: [],
                                addQuickFilterConfig: {
                                    whiteListFields: whiteListFields
                                }
                            },
                            advancedFilterPanelConfig: {
                                advancedFilterRowsConfig: {
                                    propertyFieldConfig: {
                                        whiteListFields: whiteListFields
                                    }
                                }
                            }
                        }
                    }
                }],
                context: context,
                modelNames: modelNames,
                storeConfig: {
                    filters: this._getFilters()
                },
                listeners: {
                    scope: this,
                    afterrender: function () {
                        this.addExportButton();
                    }
                }
            };

        this.add(gridBoardConfig);
    },

    _getChartConfig: function () {
        return {
            xtype: 'rallychart',
            chartColors: ['#937bb7'],
            storeType: 'Rally.data.wsapi.Store',
            storeConfig: {
                context: this.getContext().getDataContext(),
                limit: Infinity,
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
                chart: { type: 'column' },
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

    onTimeboxScopeChange: function () {
        this.callParent(arguments);

        var gridBoard = this.down('rallygridboard');
        if (gridBoard) {
            gridBoard.destroy();
        }
        this._addChart();
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

    _isByRelease: function () {
        return this.getSetting('bucketBy') === 'release';
    },

    _getFilters: function () {
        var queries = [{
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

        var timeboxScope = this.getContext().getTimeboxScope();
        if (timeboxScope && timeboxScope.isApplicable(this.model) && !this._isByRelease()) {
            queries.push(timeboxScope.getQueryFilter());
        }
        if (this.getSetting('query')) {
            queries.push(Rally.data.QueryFilter.fromQueryString(this.getSetting('query')));
        }
        return queries;
    },

    addExportButton: function () {
        let ct = this.down('rallyleftright');
        if (ct && ct.getRight()) {
            ct.getRight().add({
                xtype: 'rallybutton',
                iconCls: 'icon-export',
                cls: 'rly-small secondary',
                handler: this._export,
                margin: '0 20 7 0',
                scope: this,
                toolTipText: 'Export...'
            });
        }
    },

    _export: function () {
        var chart = this.down('rallychart');
        if (!chart) {
            Rally.ui.notify.Notifier.showError({ message: "No chart data to export." });
            return;
        }

        var data = chart && chart.getChartData();
        if (!data) {
            Rally.ui.notify.Notifier.showError({ message: "No chart data to export." });
            return;
        }

        var csv = [];
        var bucket = this.getSetting('bucketBy');
        var workitems = _.pluck(data.series, 'name');
        var headers = [bucket].concat(workitems);

        csv.push(headers.join(','));
        for (var i = 0; i < data.categories.length; i++) {
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
        var fileName = `cycle-time-${Rally.util.DateTime.format(new Date(), 'Y-m-d-h-i-s')}.csv`;
        CATS.workitemThroughput.utils.Toolbox.saveAs(csv, fileName);
    },
});
