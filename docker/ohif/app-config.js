// A context UUID selects this tab's authenticated launch; it is not a bearer token.
const risproContext = new URLSearchParams(window.location.search).get('risproContext');
const risproDicomWebRoot = /^[a-f0-9-]{36}$/i.test(risproContext || '')
  ? '/ohif-dicomweb/context/' + risproContext : '/ohif-dicomweb';
window.config = {
  routerBasename: '/ohif',
  showStudyList: false,
  // Leave bandwidth available for visible images on slower connections.
  maxNumRequests: {
    interaction: 4,
    thumbnail: 1,
    prefetch: 1,
  },
  extensions: [],
  modes: [],
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'risproDicomWeb',
      configuration: {
        friendlyName: 'RISpro authorized imaging source',
        name: 'RISpro',
        qidoRoot: risproDicomWebRoot,
        wadoRoot: risproDicomWebRoot,
        wadoUriRoot: risproDicomWebRoot,
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
