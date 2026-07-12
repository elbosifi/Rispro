window.config = {
  routerBasename: '/ohif',
  showStudyList: false,
  extensions: [],
  modes: [],
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'risproDicomWeb',
      configuration: {
        friendlyName: 'RISpro authorized imaging source',
        name: 'RISpro',
        qidoRoot: '/ohif-dicomweb',
        wadoRoot: '/ohif-dicomweb',
        wadoUriRoot: '/ohif-dicomweb',
        qidoSupportsIncludeField: true,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: false,
      },
    },
  ],
  defaultDataSourceName: 'risproDicomWeb',
};
