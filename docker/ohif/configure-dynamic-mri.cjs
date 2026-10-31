const fs = require('node:fs');
const path = require('node:path');

function configureDynamicMri(root) {
  const viewport = path.join(root, 'extensions/cornerstone/src/Viewport/OHIFCornerstoneViewport.tsx');
  let source = fs.readFileSync(viewport, 'utf8');
  if (source.includes("import DynamicMri from")) throw Error('Pinned dynamic MRI viewport already patched');
  const anchors = ["import CinePlayer from '../components/CinePlayer';", '          <CinePlayer\n'];
  for (const anchor of anchors) if (source.split(anchor).length !== 2) throw Error('Pinned dynamic MRI viewport integration changed: ' + anchor.trim());
  source = source.replace(anchors[0], anchors[0] + "\nimport DynamicMri from '../components/RisproDynamicMri/DynamicMri';");
  source = source.replace(anchors[1], '          <DynamicMri enabledVPElement={enabledVPElement} viewportId={viewportId} servicesManager={servicesManager} displaySets={displaySets} />\n' + anchors[1]);
  fs.cpSync(path.join(__dirname, 'dynamic-mri'), path.join(root, 'extensions/cornerstone/src/components/RisproDynamicMri'), { recursive: true });
  fs.writeFileSync(viewport, source);
}
module.exports = { configureDynamicMri };
if (require.main === module) configureDynamicMri(process.cwd());
