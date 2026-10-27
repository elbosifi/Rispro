// Source-only integration for the pinned v3.12.6 layout. Keep rendering/loading owned by OHIF.
const fs = require('node:fs');
const path = require('node:path');

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
  replace(study, '        onClickThumbnail={() => {}}', `        onClickThumbnail={async uid => {
          if (!window.matchMedia('(pointer: coarse)').matches) return;
          await onDoubleClickThumbnailHandler(uid);
          if (window.matchMedia('(max-width: 1023px)').matches) {
            const { panelService } = servicesManager.services;
            panelService._broadcastEvent(panelService.EVENTS.PANELS_CHANGED,
              { position: 'left', options: { leftPanelClosed: true } });
          }
        }}`);
  replace(study, '        onDoubleClickThumbnail={onDoubleClickThumbnailHandler}', `        onDoubleClickThumbnail={uid => {
          if (!window.matchMedia('(pointer: coarse)').matches) onDoubleClickThumbnailHandler(uid);
        }}`);
  // Native click synthesis distinguishes a tap from scrolling. The upstream
  // touchend shortcut also fires after a scroll and would select twice on a tap.
  replace('platform/ui-next/src/components/Thumbnail/Thumbnail.tsx',
    '      onTouchEnd={handleTouchEnd}', `      onTouchEnd={e => {
        if (!window.matchMedia('(pointer: coarse)').matches) handleTouchEnd(e);
      }}`);
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
module.exports = { configureResponsive };
if (require.main === module) configureResponsive(process.cwd());
