// A context UUID selects this tab's authenticated launch; it is not a bearer token.
const risproParams = new URLSearchParams(window.location.search);
const risproContext = risproParams.get('risproContext');
const risproStudyInstanceUIDs = [...new Set([
  risproParams.get('StudyInstanceUIDs') || '',
  risproParams.get('risproPriorStudyUIDs') || '',
].join(',').split(',').filter(uid => /^[0-9]+(?:\.[0-9]+)+$/.test(uid) && uid.length <= 64))];
const risproDicomWebRoot = /^[a-f0-9-]{36}$/i.test(risproContext || '')
  ? '/ohif-dicomweb/context/' + risproContext : '/ohif-dicomweb';
const risproNativeDelivery = risproParams.get('risproDelivery') === 'native' && /^[a-f0-9-]{36}$/i.test(risproContext || '');
const risproWadoRoot = risproNativeDelivery ? '/ohif-native/context/' + risproContext : risproDicomWebRoot;
window.config = {
  routerBasename: '/ohif',
  showStudyList: false,
  showLoadingIndicator: true,
  whiteLabeling: {
    createLogoComponentFn: React => React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', height: '32px' },
    }, React.createElement('img', {
      src: '/ohif/assets/nccb-logo.png', alt: 'NCCB',
      style: { height: '28px', maxWidth: '64px', objectFit: 'contain' },
    }), React.createElement('span', { style: { fontSize: '12px', color: 'white' } }, 'NCCB')),
  },
  // Bounded LAN thumbnails; retain the proxy's existing rollback settings.
  maxNumRequests: {
    interaction: 4,
    thumbnail: risproNativeDelivery ? 4 : 1,
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
        wadoRoot: risproWadoRoot,
        wadoUriRoot: risproDicomWebRoot,
        qidoSupportsIncludeField: true,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: risproNativeDelivery ? 'rendered' : 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: false,
      },
    },
  ],
  defaultDataSourceName: 'risproDicomWeb',
};
