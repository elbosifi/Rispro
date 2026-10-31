import React, { useEffect, useRef, useState } from 'react';
import { cache, metaData, eventTarget, Enums, utilities, imageLoader, imageLoadPoolManager } from '@cornerstonejs/core';
import { Enums as ToolEnums, state as toolState } from '@cornerstonejs/tools';
import { useSystem } from '@ohif/core';
import { Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, useCine } from '@ohif/ui-next';
import { temporalContext, sampleCurve, curveStatus, curveValues, timeAxis } from './analysis.mjs';
import { installPhaseNavigation } from './navigation.mjs';
import './dynamic-mri.css';

export default function DynamicMri({ enabledVPElement: element, viewportId, servicesManager, displaySets }) {
  const { commandsManager } = useSystem();
  const [{ isCineEnabled }] = useCine();
  const { viewportGridService, cornerstoneViewportService, toolGroupService } = servicesManager.services;
  const [context, setContext] = useState(null);
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState(1);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('Draw an Elliptical ROI on an acquisition plane.');
  const [mode, setMode] = useState('signal');
  const [baseline, setBaseline] = useState('none');
  const chosen = useRef(null), generation = useRef(0), previousTool = useRef(null);
  const group = () => toolGroupService.getToolGroupForViewport(viewportId);
  const restore = () => {
    generation.current++;
    if (previousTool.current) {
      commandsManager.runCommand('setToolActive', { toolName: previousTool.current, toolGroupId: group()?.id });
      previousTool.current = null;
    }
  };

  useEffect(() => {
    if (!element || new URLSearchParams(window.location.search).get('risproDynamicMri') === 'off') return;
    let found = false;
    const discover = () => {
      if (found) return;
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const volume = displaySets.length === 1 && cache.getVolume(displaySets[0].displaySetInstanceUID, true);
      if (!viewport?.getActors?.().some(actor => actor.referencedId === volume?.volumeId || actor.uid === volume?.volumeId)) return;
      const eligible = temporalContext(displaySets, volume, id => metaData.get('instance', id));
      if (eligible) { found = true; setContext(eligible); setPhase(volume.dimensionGroupNumber); }
    };
    const activeChanged = () => setActive(viewportGridService.getActiveViewportId() === viewportId);
    const subscription = viewportGridService.subscribe(viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED, activeChanged);
    activeChanged(); discover();
    element.addEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, discover);
    element.addEventListener(Enums.Events.IMAGE_RENDERED, discover);
    return () => {
      subscription.unsubscribe();
      element.removeEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, discover);
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, discover);
      setContext(null); setOpen(false); chosen.current = null; restore();
    };
  }, [element, displaySets, viewportId]);

  useEffect(() => {
    if (!context) return;
    const changed = event => {
      if (event.detail.volumeId === context.volume.volumeId) setPhase(context.volume.dimensionGroupNumber);
    };
    eventTarget.addEventListener(Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED, changed);
    return () => eventTarget.removeEventListener(Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED, changed);
  }, [context]);

  useEffect(() => {
    if (!context || !active) return;
    return installPhaseNavigation({ element, viewportId, toolGroup: group(), volume: context.volume,
      interacting: () => toolState.isInteractingWithTool || toolState.isMultiPartToolActive });
  }, [context, active, element]);

  useEffect(() => {
    if (!open || !context) return;
    const calculate = async annotation => {
      const version = ++generation.current;
      setResults([]); setStatus('Loading ROI pixels…');
      try {
        const sampled = await sampleCurve(context, annotation, {
          cancelled: () => version !== generation.current,
          worldToIndex: point => utilities.transformWorldToIndexContinuous(context.volume.imageData, point),
          loadImage: id => {
            const cached = cache.getImage(id);
            if (cached) return Promise.resolve(cached);
            return new Promise((resolve, reject) => imageLoadPoolManager.addRequest(
              () => imageLoader.loadAndCacheImage(id, { requestType: Enums.RequestType.Interaction }).then(resolve, reject),
              Enums.RequestType.Interaction, { imageId: id }, 5
            ));
          },
        });
        if (version !== generation.current || !sampled) return;
        setResults(sampled);
        setStatus(curveStatus(sampled));
      } catch (error) {
        if (version === generation.current) setStatus('Measurement unavailable: ' + error.message);
      }
    };
    const completed = event => {
      const annotation = event.detail.annotation;
      if (viewportGridService.getActiveViewportId() !== viewportId || annotation?.metadata?.toolName !== 'EllipticalROI' ||
          !context.ids.includes(annotation.metadata.referencedImageId)) return;
      chosen.current = annotation.annotationUID; calculate(annotation);
    };
    const modified = event => {
      if (event.detail.changeType !== ToolEnums.ChangeTypes.StatsUpdated && event.detail.annotation?.annotationUID === chosen.current) calculate(event.detail.annotation);
    };
    const removed = event => {
      if (event.detail.annotation?.annotationUID === chosen.current) {
        generation.current++; chosen.current = null; setResults([]); setStatus('ROI removed. Draw another Elliptical ROI.');
      }
    };
    const listeners = [[ToolEnums.Events.ANNOTATION_COMPLETED, completed], [ToolEnums.Events.ANNOTATION_MODIFIED, modified], [ToolEnums.Events.ANNOTATION_REMOVED, removed]];
    listeners.forEach(([name, listener]) => eventTarget.addEventListener(name, listener));
    return () => { generation.current++; listeners.forEach(([name, listener]) => eventTarget.removeEventListener(name, listener)); };
  }, [open, context]);

  if (!context || !active) return null;
  const start = () => {
    previousTool.current = group()?.getActivePrimaryMouseButtonTool();
    chosen.current = null; setResults([]); setBaseline('none'); setMode('signal');
    setStatus('Draw an Elliptical ROI on an acquisition plane.'); setOpen(true);
    commandsManager.runCommand('setToolActive', { toolName: 'EllipticalROI', toolGroupId: group()?.id });
  };
  let values = [], error = '';
  try { values = curveValues(results, mode, baseline); } catch (reason) { error = reason.message; }
  if (!error && mode === 'enhancement' && results.some((result, i) => Number.isFinite(result.mean) && !Number.isFinite(values[i]))) {
    error = 'Enhancement unavailable for phases with different valid ROI pixels or signal units.';
  }
  const axis = timeAxis(results), finite = values.filter(Number.isFinite);
  const lower = Math.min(...finite), upper = Math.max(...finite), range = upper - lower || 1;
  const x = i => 40 + 240 * (axis.values[i] - axis.values[0]) / (axis.values.at(-1) - axis.values[0] || 1);
  const y = value => 116 - 90 * (value - lower) / range;
  const current = results.find(result => result.phase === phase), base = results.find(result => result.phase === Number(baseline));
  const format = value => Number.isFinite(value) ? Number(value.toFixed(2)).toString() : 'Unavailable';
  return <div className="rispro-dynamic-mri" style={{ top: isCineEnabled ? '7.5rem' : undefined }} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    {!open ? <Button size="sm" variant="secondary" onClick={start}>Enhancement Curve</Button> :
      <section aria-label="MRI enhancement curve" className="bg-background text-foreground border-input rounded border p-2 shadow-lg">
        <div className="flex items-center justify-between gap-2"><strong>Enhancement Curve</strong><Button size="sm" variant="ghost" aria-label="Close enhancement curve" onClick={() => { setOpen(false); restore(); }}>×</Button></div>
        <div className="flex gap-2">
          <Select value={mode} onValueChange={setMode}><SelectTrigger className="text-xs" aria-label="Curve measurement"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="signal">Mean SI (a.u.)</SelectItem><SelectItem value="enhancement">Enhancement (%)</SelectItem></SelectContent></Select>
          <Select value={baseline} onValueChange={setBaseline}><SelectTrigger className="text-xs" aria-label="Baseline phase"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Select baseline</SelectItem>{context.frames.map((_, i) => <SelectItem key={i} value={String(i + 1)}>{`Baseline: phase ${i + 1}`}</SelectItem>)}</SelectContent></Select>
        </div>
        {(status || error) && <p role="status" className="my-2 text-xs">{status || error}</p>}
        {!!finite.length && <svg viewBox="0 0 300 160" role="img" aria-label={`${mode === 'signal' ? 'Mean signal intensity' : 'Relative enhancement'} by ${axis.label}`} data-values={JSON.stringify(values)}>
          <path d="M40 20 V120 H285" fill="none" stroke="currentColor" />
          <text x="2" y="27">{format(upper)}</text><text x="2" y="117">{format(lower)}</text>
          {values.map((value, i) => Number.isFinite(value) && <g key={i}>
            {i > 0 && Number.isFinite(values[i - 1]) && <line x1={x(i - 1)} y1={y(values[i - 1])} x2={x(i)} y2={y(value)} stroke="var(--color-primary, #48c5e8)" strokeWidth="2" />}
            <circle cx={x(i)} cy={y(value)} r={phase === i + 1 ? 5 : 2} fill="currentColor" data-phase={i + 1} data-current={phase === i + 1} />
            <text x={x(i)} y="136" textAnchor="middle">{format(axis.values[i])}</text>
          </g>)}<text x="160" y="154" textAnchor="middle">{axis.label} · {mode === 'signal' ? 'SI (a.u.)' : 'Enhancement (%)'}</text>
        </svg>}
        <p className="text-xs" data-testid="roi-summary">Phase {phase}/{context.frames.length} · Mean: {format(current?.mean)} a.u. · Valid pixels: {current?.count ?? '—'}<br />Baseline: {base ? `phase ${base.phase}, ${format(base.mean)} a.u.` : 'not selected (precontrast not assumed)'}</p>
        <p className="mt-1 text-xs">Select Stack Scroll to navigate phases; ROI editing keeps priority. Signal only; no motion correction.</p>
      </section>}
  </div>;
}
