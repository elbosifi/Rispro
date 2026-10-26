// Narrow source customizations for pinned OHIF v3.12.6; never patch bundles.
const fs = require('node:fs');
const path = require('node:path');

async function getStudiesForPatientByMRN(dataSource, currentStudies) {
  if (!currentStudies?.length) return [];
  const studyUids = dataSource.getConfig()?.risproStudyInstanceUIDs;
  if (Array.isArray(studyUids)) {
    // These URL selectors grant no access. RISpro rechecks the persisted launch
    // allowlist for every exact-study query, metadata request and frame.
    const studies = await Promise.all(studyUids.map(studyInstanceUid => {
      const current = currentStudies.find(study => study.studyInstanceUid === studyInstanceUid);
      return current ? [current] : dataSource.query.studies.search({ studyInstanceUid });
    }));
    return studies.flat();
  }
  const mrn = currentStudies[0].mrn;
  return mrn ? dataSource.query.studies.search({ patientId: mrn, disableWildcard: true }) : currentStudies;
}

const diagnosticSeriesRules = [
  { weight: 5, attribute: 'Modality', constraint: { equals: { value: 'CT' } } },
  { weight: 5, attribute: 'Modality', constraint: { equals: { value: 'MR' } } },
  { weight: 5, attribute: 'numImageFrames', constraint: { greaterThan: { value: 1 } } },
  ...['2','2.1','2.2','4','4.1','4.4'].map(suffix => ({
    weight: 5, attribute: 'SOPClassUID', constraint: { equals: { value: '1.2.840.10008.5.1.4.1.1.' + suffix } },
  })),
];

function configureViewer(root) {
  const webpack = path.join(root, '.webpack/webpack.base.js');
  const webpackSource = fs.readFileSync(webpack, 'utf8');
  const rulesAnchor = 'noParse: [/(dicomicc)/],\n      rules: [';
  if (webpackSource.split(rulesAnchor).length !== 2) throw Error('Pinned Webpack rules changed');
  // ONNX's browser ESM guards access to the Node-only __filename. Webpack's
  // NodeStuffPlugin evaluates that guard as true in ESM without supplying the
  // identifier. Preserve the dependency's browser guard; do not polyfill it.
  fs.writeFileSync(webpack, webpackSource.replace(rulesAnchor, rulesAnchor + `
        { test: /[\\\\/]onnxruntime-web[\\\\/]dist[\\\\/]esm[\\\\/]/, parser: { node: false } },`));

  const serviceWorker = path.join(root, 'platform/app/public/init-service-worker.js');
  const serviceWorkerSource = fs.readFileSync(serviceWorker, 'utf8');
  const registration = 'navigator.serviceWorker.getRegistrations().then';
  if (!serviceWorkerSource.startsWith(registration)) throw Error('Pinned service worker bootstrap changed');
  // navigator.serviceWorker is unavailable on ordinary hospital-LAN HTTP.
  fs.writeFileSync(serviceWorker, serviceWorkerSource.replace(registration, "if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then"));

  const lookup = path.join(root, 'extensions/default/src/Panels/getStudiesForPatientByMRN.js');
  if (!fs.readFileSync(lookup, 'utf8').includes('patientId: mrn')) throw Error('Pinned study browser integration changed');
  fs.writeFileSync(lookup, getStudiesForPatientByMRN.toString() + '\nexport default getStudiesForPatientByMRN;\n');

  const hp = path.join(root, 'extensions/default/src/getHangingProtocolModule.js');
  const source = fs.readFileSync(hp, 'utf8');
  const anchor = 'seriesMatchingRules: [';
  if (source.split(anchor).length !== 2) throw Error('Pinned default hanging protocol changed');
  // Weighted preferences preserve document-only fallback and explicit URL
  // selection (weight 20). MPR/comparison protocols and manual selection stay intact.
  fs.writeFileSync(hp, source.replace(anchor, anchor + '\n' + diagnosticSeriesRules.map(rule => JSON.stringify(rule) + ',').join('\n')));
}

module.exports = { configureViewer, getStudiesForPatientByMRN, diagnosticSeriesRules };
if (require.main === module) configureViewer(process.cwd());
