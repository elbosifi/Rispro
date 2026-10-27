// Source-only integration for the pinned v3.12.6 layout. Keep rendering/loading owned by OHIF.
const fs = require('node:fs');
const path = require('node:path');

async function selectSupportedDisplaySet(uid, servicesManager, select, commandsManager) {
  const { displaySetService, uiNotificationService, viewportGridService, cornerstoneViewportService } = servicesManager.services;
  const displaySet = displaySetService.getDisplaySetByUID(uid);
  if (!displaySet || displaySet.unsupported) {
    uiNotificationService.show({ title: 'Unsupported content',
      message: 'This series is not supported by this viewer. Select an imaging series to continue.',
      type: 'warning', duration: 5000 });
    return false;
  }
  try {
    const viewportId = viewportGridService?.getActiveViewportId();
    const viewport = cornerstoneViewportService?.getCornerstoneViewport(viewportId);
    // A scanned Secondary Capture can be a supported stack without patient-space
    // geometry. Retaining an MPR viewport for it creates NaN volume bounds and
    // an invalid vtkMaximumNumberOfSamples shader. Route it before volume setup.
    if (!displaySet.isReconstructable && displaySet.images?.length &&
        displaySet.SOPClassHandlerId === '@ohif/extension-default.sopClassHandlerModule.stack' &&
        ['orthographic', 'volume'].includes(viewport?.type)) {
      commandsManager.run('setDisplaySetsForViewports', { viewportsToUpdate: [{
        viewportId, displaySetInstanceUIDs: [uid],
        viewportOptions: { viewportType: 'stack', toolGroupId: 'default', presentationIds: {} },
        displaySetOptions: [{}],
      }] });
      return true;
    }
    // Keep OHIF's registered PDF, SR and other supported handlers, including
    // non-reconstructable scanned images. Warning badges are not a type check.
    await select(uid);
    return true;
  } catch (error) {
    console.warn('OHIF series selection failed', error);
    uiNotificationService.show({ title: 'Unable to open series',
      message: 'This series could not be opened. Select another series to continue.',
      type: 'error', duration: 5000 });
    return false;
  }
}

function configureResponsive(root) {
  const replace = (file, anchor, replacement) => {
    const filename = path.join(root, file);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
    if (source.split(anchor).length !== 2) throw Error('Pinned OHIF responsive anchor changed: ' + file);
    fs.writeFileSync(filename, source.replace(anchor, replacement));
  };
  const layout = 'extensions/default/src/ViewerLayout/index.tsx';
  replace(layout, 'const resizableHandleClassName', "import { useResponsivePanels } from '../RisproResponsive/useResponsivePanels';\nimport '../RisproResponsive/responsive.css';\n\nconst resizableHandleClassName");
  for (const side of ['left', 'right']) {
    replace(layout, `useState(${side}PanelClosed)`, `useState(${side}PanelClosed || window.matchMedia('(max-width: 1023px)').matches)`);
    replace(layout, `    ${side}PanelClosed,\n    set`, `    ${side}PanelClosedState,\n    set`);
    replace(layout, `<ResizablePanel {...resizable${side[0].toUpperCase() + side.slice(1)}PanelProps}>`,
      `<ResizablePanel {...resizable${side[0].toUpperCase() + side.slice(1)}PanelProps} data-rispro-panel="${side}" data-open={!${side}PanelClosedState}>`);
  }
  replace(layout, '  const handleMouseEnter = () => {', '  useResponsivePanels(setLeftPanelClosed, setRightPanelClosed);\n\n  const handleMouseEnter = () => {');
  replace(layout, '    <div>\n      <ViewerHeader', '    <div className="rispro-viewer">\n      <ViewerHeader');
  replace(layout, 'className="relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden bg-black"',
    'className="rispro-workspace relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden bg-black"');
  const header = 'extensions/default/src/ViewerLayout/ViewerHeader.tsx';
  replace(header, "import { Button, Header, Icons, useModal }", "import { Button, Icons, useModal }");
  replace(header, "import { Toolbar } from '../Toolbar/Toolbar';", "import { Toolbar } from '../Toolbar/Toolbar';\nimport { ResponsiveHeader as Header } from '../RisproResponsive/ResponsiveHeader';");
  const toolbar = 'extensions/default/src/Toolbar/Toolbar.tsx';
  replace(toolbar, '  buttonSection?: string;', '  buttonSection?: string;\n  buttonFilter?: (id: string) => boolean;');
  replace(toolbar, "export function Toolbar({ buttonSection = 'primary', viewportId, location }: ToolbarProps)",
    "export function Toolbar({ buttonSection = 'primary', viewportId, location, buttonFilter }: ToolbarProps)");
  replace(toolbar, '        if (!toolDef) {', '        if (!toolDef || (buttonFilter && !buttonFilter(toolDef.id))) {');
  const study = 'extensions/default/src/Panels/StudyBrowser/PanelStudyBrowser.tsx';
  replace(study, 'function PanelStudyBrowser({', selectSupportedDisplaySet.toString() + '\n\nfunction PanelStudyBrowser({');
  replace(study, '        onClickThumbnail={() => {}}', `        onClickThumbnail={async uid => {
          if (!window.matchMedia('(pointer: coarse)').matches) return;
          if (!await selectSupportedDisplaySet(uid, servicesManager, onDoubleClickThumbnailHandler, commandsManager)) return;
          if (window.matchMedia('(max-width: 1023px)').matches) {
            const { panelService } = servicesManager.services;
            panelService._broadcastEvent(panelService.EVENTS.PANELS_CHANGED,
              { position: 'left', options: { leftPanelClosed: true } });
          }
        }}`);
  replace(study, '        onDoubleClickThumbnail={onDoubleClickThumbnailHandler}', `        onDoubleClickThumbnail={uid => {
          if (!window.matchMedia('(pointer: coarse)').matches) {
            void selectSupportedDisplaySet(uid, servicesManager, onDoubleClickThumbnailHandler, commandsManager);
          }
        }}`);
  const thumbnail = 'platform/ui-next/src/components/Thumbnail/Thumbnail.tsx';
  replace(thumbnail, "import React, { useState } from 'react';",
    "import React, { useState, useRef } from 'react';\nimport { thumbnailTouchHandlers } from './risproThumbnailTouch';");
  replace(thumbnail, '  const [lastTap, setLastTap] = useState(0);', `  const [lastTap, setLastTap] = useState(0);
  const touch = thumbnailTouchHandlers(useRef(null), onClick,
    () => window.matchMedia('(pointer: coarse)').matches);`);
  replace(thumbnail, '      onTouchEnd={handleTouchEnd}', `      onTouchStart={touch.onTouchStart}
      onTouchMove={touch.onTouchMove}
      onTouchCancel={touch.onTouchCancel}
      onTouchEnd={e => { if (!touch.onTouchEnd(e)) handleTouchEnd(e); }}`);
  fs.copyFileSync(path.join(__dirname, 'responsive', 'thumbnailTouch.js'),
    path.join(root, 'platform/ui-next/src/components/Thumbnail/risproThumbnailTouch.js'));
  // Permit ordinary browser zoom and safe areas; touch-action is confined to image elements.
  replace('platform/app/public/html-templates/index.html',
    'width=device-width, initial-scale=1, shrink-to-fit=no, maximum-scale=1.0, user-scalable=no',
    'width=device-width, initial-scale=1, viewport-fit=cover');
  const destination = path.join(root, 'extensions/default/src/RisproResponsive');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['ResponsiveHeader.tsx', 'useResponsivePanels.ts', 'responsive.css']) {
    fs.copyFileSync(path.join(__dirname, 'responsive', name), path.join(destination, name));
  }
}
module.exports = { configureResponsive, selectSupportedDisplaySet };
if (require.main === module) configureResponsive(process.cwd());
