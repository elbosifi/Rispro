import React, { useEffect, useState } from 'react';
import { useSystem } from '@ohif/core';
import {
  Header, Button, ToolButton, IconPresentationProvider, Popover, PopoverTrigger, PopoverContent,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@ohif/ui-next';
import { Toolbar } from '../Toolbar/Toolbar';

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function ResponsiveHeader(props) {
  const compact = useMedia('(max-width: 1279px)');
  const phone = useMedia('(max-width: 767px), (max-width: 1023px) and (max-height: 500px)');
  const [more, setMore] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const { servicesManager } = useSystem();
  const { panelService } = servicesManager.services;
  const essential = phone ? ['WindowLevel', 'MeasurementTools'] :
    ['WindowLevel', 'Zoom', 'Pan', 'MeasurementTools', 'Layout'];
  // No toolbar definitions, evaluators or commands are copied here. Even async
  // RISpro registration is observed by the original Toolbar/useToolbar pipeline.
  const primary = id => essential.includes(id);
  const overflow = id => !essential.includes(id) && id !== 'RISproReport';
  useEffect(() => {
    const root = document.querySelector('.rispro-viewer');
    root?.classList.toggle('rispro-maximized', compact && maximized);
    return () => root?.classList.remove('rispro-maximized');
  }, [compact, maximized]);
  if (!compact) return <Header {...props} />;

  const openSeries = () => {
    setMore(false);
    panelService._broadcastEvent(panelService.EVENTS.PANELS_CHANGED, {
      position: 'left', options: {
        leftPanelClosed: false,
        ...(window.matchMedia('(max-width: 1023px)').matches ? { rightPanelClosed: true } : {}),
      },
    });
  };
  const openPanel = id => {
    setMore(false);
    panelService._broadcastEvent(panelService.EVENTS.PANELS_CHANGED, {
      position: 'right', options: { rightPanelClosed: false,
        ...(window.matchMedia('(max-width: 1023px)').matches ? { leftPanelClosed: true } : {}),
      },
    });
    panelService.activatePanel(id, true);
  };
  return <IconPresentationProvider size="large" IconContainer={ToolButton}>
    <header className="rispro-compact-header" aria-label="Viewer controls">
    <div className="rispro-header-context">
      <div className="rispro-brand">{props.WhiteLabeling?.createLogoComponentFn?.(React, {})}</div>
      {props.PatientInfo && <Popover>
        <PopoverTrigger asChild><Button variant="ghost">Patient</Button></PopoverTrigger>
        <PopoverContent className="rispro-patient-info" align="start">{props.PatientInfo}</PopoverContent>
      </Popover>}
      <div className="rispro-header-report"><Toolbar buttonFilter={id => id === 'RISproReport'} /></div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" aria-label="Viewer settings">Settings</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {props.menuOptions.map(option => <DropdownMenuItem key={option.title} onSelect={option.onClick}>{option.title}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <nav className="rispro-diagnostic-toolbar" aria-label="Diagnostic tools">
      <Button variant="ghost" onClick={openSeries}>Series</Button>
      <Toolbar buttonSection="MoreTools" buttonFilter={id => id === 'StackScroll'} />
      <Toolbar buttonFilter={primary} />
      <Popover open={more} onOpenChange={setMore}>
        <PopoverTrigger asChild><Button variant="ghost" aria-label="More tools">More</Button></PopoverTrigger>
        <PopoverContent className="rispro-overflow" align="end" aria-label="More diagnostic tools">
          <div className="rispro-overflow-tools"><Toolbar buttonFilter={overflow} /></div>
          <div className="rispro-overflow-auxiliary">
            {props.Secondary}{props.UndoRedo}
            <Button variant="ghost" onClick={() => { setMaximized(!maximized); setMore(false); }}>
              {maximized ? 'Show header' : 'Maximize image'}
            </Button>
          </div>
          <nav className="rispro-overflow-auxiliary" aria-label="Viewer panels">
            {panelService.getPanels('right').map(panel => <Button key={panel.id} variant="ghost"
              disabled={panel.disabled} onClick={() => openPanel(panel.id)}>{panel.label}</Button>)}
          </nav>
        </PopoverContent>
      </Popover>
    </nav>
  </header></IconPresentationProvider>;
}
