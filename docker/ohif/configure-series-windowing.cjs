// A newly opened diagnostic stack uses its stored DICOM VOI, not a previous
// visit's edited window. Rendering, loading and same-series resizing stay upstream.
const fs = require('node:fs');
const path = require('node:path');

function dicomWindowProperties(imageId, metadata, windowLevel) {
  const instance = metadata.get('instance', imageId);
  if (!['CT', 'MR'].includes(instance?.Modality)) return;
  const voi = metadata.get('voiLutModule', imageId);
  const first = value => Array.isArray(value) ? value[0] : value;
  const width = first(voi?.windowWidth);
  const center = first(voi?.windowCenter);
  if (width == null || center == null || !Number.isFinite(Number(width)) ||
      Number(width) <= 0 || !Number.isFinite(Number(center))) return;
  const VOILUTFunction = voi.voiLUTFunction || 'LINEAR';
  // These are the functions supported by the pinned Cornerstone range API.
  if (!['LINEAR', 'LINEAR_EXACT', 'SAMPLED_SIGMOID'].includes(VOILUTFunction)) return;
  return {
    VOILUTFunction,
    voiRange: windowLevel.toLowHighRange(Number(width), Number(center), VOILUTFunction),
  };
}

function configureSeriesWindowing(root) {
  const file = 'extensions/cornerstone/src/services/ViewportService/CornerstoneViewportService.ts';
  const filename = path.join(root, file);
  let source = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
  if (source.includes('function dicomWindowProperties(')) throw Error('Pinned OHIF series windowing anchor changed: already configured');
  const replace = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw Error('Pinned OHIF series windowing anchor changed: ' + file);
    source = source.replace(anchor, replacement);
  };
  replace('  cache,\n', '  cache,\n  metaData,\n');
  replace('const EVENTS = {', dicomWindowProperties.toString() + '\n\nconst EVENTS = {');
  const ids = '    const displaySetInstanceUIDs = viewportData.data.map(data => data.displaySetInstanceUID);';
  replace(ids, ids + `
    const openingSeries = this.viewportsDisplaySets.get(viewport.id)?.[0] !== displaySetInstanceUIDs[0];`);
  const stack = '    return viewport.setStack(imageIds, initialImageIndexToUse).then(() => {';
  replace(stack, `    if (openingSeries) {
      const dicomProperties = dicomWindowProperties(
        imageIds[initialImageIndexToUse], metaData, csUtils.windowLevel
      );
      if (dicomProperties) {
        Object.assign(properties, dicomProperties);
        // Copy the presentation; never mutate OHIF's stored state. Preserve
        // camera, slice, invert, colormap, annotations and segmentation.
        if (presentations.lutPresentation) {
          presentations = { ...presentations, lutPresentation: {
            ...presentations.lutPresentation, properties: { ...properties },
          } };
        }
      }
    }

` + stack);
  fs.writeFileSync(filename, source);
}

module.exports = { configureSeriesWindowing, dicomWindowProperties };
if (require.main === module) configureSeriesWindowing(process.cwd());
