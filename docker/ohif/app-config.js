// A context UUID selects this tab's authenticated launch; it is not a bearer token.
const risproParams = new URLSearchParams(window.location.search);
const risproContext = risproParams.get('risproContext');
const risproStudyInstanceUIDs = [...new Set([
  risproParams.get('StudyInstanceUIDs') || '',
  risproParams.get('risproPriorStudyUIDs') || '',
].join(',').split(',').filter(uid => /^[0-9]+(?:\.[0-9]+)+$/.test(uid) && uid.length <= 64))];
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
        // Discovery selectors only; the server's per-tab allowlist remains authoritative.
        risproStudyInstanceUIDs,
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
