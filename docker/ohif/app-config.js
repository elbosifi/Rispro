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
const risproProgressiveLoading = risproNativeDelivery && risproParams.get('risproLoadingProfile') === 'progressive';
const risproWadoRoot = risproNativeDelivery ? '/ohif-native/context/' + risproContext : risproDicomWebRoot;
// Native defaults to the existing 100/4/25 profile; current restores 4/4/1.
// Per-tab profiles affect loading only; server-side study authorization is unchanged.
const risproFastLoading = risproNativeDelivery && risproParams.get('risproLoadingProfile') !== 'current';
// Retain the explicit upstream experiment, including its optional thumbnail bound.
const risproBoundedThumbnails = risproParams.get('risproLoadingProfile') !== 'upstream'
  || risproParams.get('risproThumbnailProfile') === 'current';
window.config = {
  risproProgressiveLoading,
  routerBasename: '/ohif',
  showStudyList: false,
  showLoadingIndicator: true,
  investigationalUseDialog: { option: 'never' },
  whiteLabeling: {
    createLogoComponentFn: React => React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', height: '32px' },
    }, React.createElement('img', {
      src: '/ohif/assets/nccb-logo.png', alt: 'NCCB',
      style: { height: '28px', maxWidth: '64px', objectFit: 'contain' },
    }), React.createElement('span', { style: { fontSize: '12px', color: 'white' } }, 'NCCB')),
  },
  // v3.12.6 platform/app/public/config/default.js (not init.tsx's fallbacks).
  // Stack context prefetch and the retrieval pool remain entirely upstream.
  // Bound competing image work in the experimental profile as well as metadata.
  // Interaction stays upstream/native; OFF retains its deployed request limits.
  maxNumRequests: risproProgressiveLoading ? {
    interaction: 100,
    thumbnail: 1,
    prefetch: 1,
  } : risproFastLoading ? {
    interaction: 100,
    thumbnail: risproBoundedThumbnails ? 4 : 75,
    prefetch: 25,
  } : {
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
        risproStudyListUrl: risproParams.get('risproSessionStudies') === '1' && /^[a-f0-9-]{36}$/i.test(risproContext || '')
          ? '/api/ohif/contexts/' + risproContext + '/studies' : null,
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
