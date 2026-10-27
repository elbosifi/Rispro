// Pinned OHIF v3.12.6 rendered thumbnails: use the DICOMweb client's singlepart
// rendered API instead of bulkDataURI (which drops mediaTypes and sends octet-stream).
const fs = require('node:fs');
const path = require('node:path');

function retrieveRenderedThumbnail(instance, client, pool, requestType, authorize) {
  return new Promise((resolve, reject) => {
    pool.addRequest(() => {
      client.headers = authorize();
      return client.retrieveInstanceRendered({
        studyInstanceUID: instance.StudyInstanceUID,
        seriesInstanceUID: instance.SeriesInstanceUID,
        sopInstanceUID: instance.SOPInstanceUID,
        mediaTypes: [{ mediaType: 'image/jpeg' }],
        queryParams: { viewport: '160,160' },
      }).then(parts => resolve(URL.createObjectURL(new Blob([parts[0]], { type: 'image/jpeg' })))).catch(reject);
    }, requestType, {}, 0);
  });
}

function configureThumbnails(root) {
  const file = path.join(root, 'extensions/default/src/DicomWebDataSource/index.ts');
  let source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const start = source.indexOf("        if (dicomWebConfig.thumbnailRendering === 'rendered') {");
  const end = source.indexOf('\n      },\n\n      directURL:', start);
  if (start < 0 || end < start || !source.slice(start, end).includes("mediaTypes: ['image/jpeg']")) {
    throw Error('Pinned OHIF rendered-thumbnail branch changed');
  }
  source = source.slice(0, start) + `        if (dicomWebConfig.thumbnailRendering === 'rendered') {
          return () => retrieveRenderedThumbnail(instance, wadoDicomWebClient,
            imageLoadPoolManager, Enums.RequestType.Thumbnail, getAuthorizationHeader);
        }` + source.slice(end);
  source = "import { imageLoadPoolManager, Enums } from '@cornerstonejs/core';\n" +
    retrieveRenderedThumbnail.toString() + '\n' + source;
  fs.writeFileSync(file, source);
}

module.exports = { configureThumbnails, retrieveRenderedThumbnail };
if (require.main === module) configureThumbnails(process.cwd());
