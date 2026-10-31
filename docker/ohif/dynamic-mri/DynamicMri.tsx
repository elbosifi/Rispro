import React, { useEffect, useRef, useState } from 'react';
import { cache, metaData, eventTarget, Enums, utilities, imageLoader, imageLoadPoolManager } from '@cornerstonejs/core';
import { Enums as ToolEnums, state as toolState, annotation as annotations, utilities as toolUtilities, cancelActiveManipulations } from '@cornerstonejs/tools';
import { useSystem } from '@ohif/core';
import { Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, useCine } from '@ohif/ui-next';
import { temporalContext, roiPlane, sampleCurve, curveStatus, curveValues, timeAxis } from './analysis.mjs';
import { installPhaseNavigation, installCurveRoiVisibility } from './navigation.mjs';
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
  const [isDrawing, setIsDrawing] = useState(false);
  const chosen = useRef(null), generation = useRef(0), previousTool = useRef(null);
  const owned = useRef(new Set<string>()), drawing = useRef(null);
  const deletePress = useRef(null);
  const seriesKey = displaySets.map(ds => `${ds.StudyInstanceUID}/${ds.SeriesInstanceUID}/${ds.displaySetInstanceUID}`).join('|');
  const group = () => toolGroupService.getToolGroupForViewport(viewportId);
  const selected = () => owned.current.has(chosen.current) && annotations.state.getAnnotation(chosen.current);
  const redraw = () => toolUtilities.triggerAnnotationRenderForViewportIds([viewportId]);
  const activate = toolName => {
    const toolGroup = group();
    if (toolGroup) commandsManager.runCommand('setToolActive', { toolName, toolGroupId: toolGroup.id });
  };
  const removeOwned = uid => {
    if (owned.current.delete(uid) && annotations.state.getAnnotation(uid)) annotations.state.removeAnnotation(uid);
    redraw();
  };
  const cancelDrawing = (scroll = true) => {
    const session = drawing.current;
    if (!session) return;
    drawing.current = null; generation.current++;
    if (session.uid && group()?.getToolInstance('EllipticalROI')?.editData?.annotation?.annotationUID === session.uid) cancelActiveManipulations(element);
    removeOwned(session.uid); setIsDrawing(false);
    if (scroll) activate('StackScroll');
  };
  const beginDrawing = () => {
    cancelDrawing(false); generation.current++;
    activate('EllipticalROI');
    drawing.current = { uid: null, completed: false }; setIsDrawing(true);
    setStatus(selected() ? 'Draw a replacement ROI. The current ROI is retained until validation.' : 'Draw an Elliptical ROI on an acquisition plane.');
  };
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
      cancelDrawing(false); restore();
      setContext(null); setOpen(false); chosen.current = null; owned.current.clear();
      setResults([]); setBaseline('none');
    };
  }, [element, seriesKey, viewportId]);

  useEffect(() => {
    if (!context) return;
    const changed = event => {
      if (event.detail.volumeId === context.volume.volumeId) {
        setPhase(context.volume.dimensionGroupNumber);
        const roi = selected();
        if (roi) roi.invalidated = true;
        redraw();
      }
    };
    eventTarget.addEventListener(Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED, changed);
    return () => eventTarget.removeEventListener(Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED, changed);
  }, [context]);

  useEffect(() => {
    if (!context || !active) return;
    const stopNavigation = installPhaseNavigation({ element, viewportId, toolGroup: group(), volume: context.volume,
      interacting: () => toolState.isInteractingWithTool || toolState.isMultiPartToolActive });
    const stopVisibility = installCurveRoiVisibility({ element, toolGroup: group(), context,
      getViewport: () => cornerstoneViewportService.getCornerstoneViewport(viewportId), getSelected: selected });
    element.addEventListener(Enums.Events.CAMERA_MODIFIED, redraw);
    redraw();
    return () => { stopNavigation(); stopVisibility(); element.removeEventListener(Enums.Events.CAMERA_MODIFIED, redraw); };
  }, [context, active, element]);

  useEffect(() => {
    if (!context) return;
    const calculate = async (annotation, session = null) => {
      const version = ++generation.current;
      if (!session) setResults([]);
      setStatus(session && selected() ? 'Validating replacement ROI…' : 'Loading ROI pixels…');
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
        if (session) {
          if (drawing.current !== session) return;
          if (!sampled.some(result => Number.isFinite(result.mean))) {
            cancelDrawing(); setStatus('ROI unavailable. ' + (selected() ? 'Original ROI retained. ' : '') + curveStatus(sampled)); return;
          }
          const previous = chosen.current;
          chosen.current = annotation.annotationUID;
          annotation.invalidated = true;
          drawing.current = null; setIsDrawing(false);
          if (!previous) setBaseline('none');
          if (previous && previous !== chosen.current) removeOwned(previous);
        }
        setResults(sampled);
        setStatus(curveStatus(sampled));
        redraw();
      } catch (error) {
        if (version === generation.current) {
          if (session) cancelDrawing();
          setStatus('Measurement unavailable: ' + error.message + (session && selected() ? ' Original ROI retained.' : ''));
        }
      }
    };
    const added = event => {
      const annotation = event.detail.annotation, session = drawing.current;
      if (!open || !session || session.uid || viewportGridService.getActiveViewportId() !== viewportId ||
          group()?.getActivePrimaryMouseButtonTool() !== 'EllipticalROI' || annotation?.metadata?.toolName !== 'EllipticalROI' ||
          (event.detail.viewportId ? event.detail.viewportId !== viewportId : annotation.metadata.FrameOfReferenceUID !== context.frameOfReferenceUID)) return;
      // addAnnotation fires before EllipticalROI sets editData. Claim only a
      // newly drawn tool gesture, never an imported/rehydrated measurement.
      queueMicrotask(() => {
        const edit = group()?.getToolInstance('EllipticalROI')?.editData;
        if (drawing.current === session && !session.uid && edit?.newAnnotation && edit.annotation === annotation) {
          session.uid = annotation.annotationUID; owned.current.add(session.uid);
        }
      });
    };
    const completed = event => {
      const annotation = event.detail.annotation, session = drawing.current;
      if (!open || !session || session.uid !== annotation?.annotationUID || !owned.current.has(session.uid)) return;
      try { roiPlane(context, annotation); }
      catch (error) { cancelDrawing(); setStatus('Measurement unavailable: ' + error.message + (selected() ? ' Original ROI retained.' : '')); return; }
      session.completed = true;
      calculate(annotation, session);
      activate('StackScroll');
    };
    const modified = event => {
      const annotation = event.detail.annotation;
      if (!owned.current.has(annotation?.annotationUID)) return;
      redraw();
      if (event.detail.changeType === ToolEnums.ChangeTypes.StatsUpdated || !open) return;
      if (annotation.annotationUID === chosen.current) {
        if (drawing.current?.completed) cancelDrawing(false);
        calculate(annotation);
      }
      else if (drawing.current?.completed && drawing.current.uid === annotation.annotationUID) calculate(annotation, drawing.current);
    };
    const removed = event => {
      const uid = event.detail.annotation?.annotationUID;
      owned.current.delete(uid);
      if (uid === chosen.current) {
        generation.current++; chosen.current = null; setResults([]); setBaseline('none'); setStatus('Draw an Elliptical ROI on an acquisition plane.');
        redraw();
      }
    };
    const activated = event => {
      if (event.detail.toolGroupId === group()?.id && drawing.current && !drawing.current.completed) {
        cancelDrawing(false); setStatus(selected() ? 'Drawing cancelled. Original ROI retained.' : 'Draw an Elliptical ROI on an acquisition plane.');
      }
    };
    const cancel = event => {
      if (!drawing.current || (event.type === 'keydown' && event.key !== 'Escape')) return;
      if (event.type === 'keydown') { event.preventDefault(); event.stopPropagation(); }
      cancelDrawing(); setStatus(selected() ? 'Drawing cancelled. Original ROI retained.' : 'Draw an Elliptical ROI on an acquisition plane.');
    };
    const listeners = [[ToolEnums.Events.ANNOTATION_ADDED, added], [ToolEnums.Events.ANNOTATION_COMPLETED, completed], [ToolEnums.Events.ANNOTATION_MODIFIED, modified], [ToolEnums.Events.ANNOTATION_REMOVED, removed], [ToolEnums.Events.TOOL_ACTIVATED, activated]];
    listeners.forEach(([name, listener]) => eventTarget.addEventListener(name, listener));
    const document = element.ownerDocument;
    document.addEventListener('keydown', cancel, true);
    element.addEventListener('touchcancel', cancel);
    if (open && selected() && !drawing.current) calculate(selected());
    return () => {
      generation.current++; listeners.forEach(([name, listener]) => eventTarget.removeEventListener(name, listener));
      document.removeEventListener('keydown', cancel, true); element.removeEventListener('touchcancel', cancel);
    };
  }, [open, context]);

  if (!context || !active) return null;
  const start = () => {
    previousTool.current = group()?.getActivePrimaryMouseButtonTool();
    setOpen(true);
    if (!selected()) { chosen.current = null; setResults([]); setBaseline('none'); setMode('signal'); beginDrawing(); }
  };
  const deleteRoi = () => {
    const uid = chosen.current;
    if (!owned.current.has(uid)) return;
    generation.current++; chosen.current = null;
    setResults([]); setBaseline('none'); setMode('signal'); setStatus('Draw an Elliptical ROI on an acquisition plane.');
    removeOwned(uid); activate('StackScroll');
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
  return <div className="rispro-dynamic-mri" style={{ top: isCineEnabled ? '7.5rem' : undefined }} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }} onKeyUp={event => event.stopPropagation()}>
    {!open ? <Button size="sm" variant="secondary" onClick={start}>Enhancement Curve</Button> :
      <section aria-label="MRI enhancement curve" data-roi-uid={chosen.current || undefined} className="bg-background text-foreground border-input rounded border p-2 shadow-lg">
        <div className="flex items-center justify-between gap-2"><strong>Enhancement Curve</strong><Button className="rispro-roi-action" size="sm" variant="ghost" aria-label="Close enhancement curve" onClick={() => { cancelDrawing(false); setOpen(false); restore(); }}>×</Button></div>
        <div className="rispro-roi-actions">
          {isDrawing ? <Button className="rispro-roi-action" size="sm" variant="secondary" onClick={() => { cancelDrawing(); setStatus(selected() ? 'Drawing cancelled. Original ROI retained.' : 'Draw an Elliptical ROI on an acquisition plane.'); }}>Cancel drawing</Button> :
            <Button className="rispro-roi-action" size="sm" variant="secondary" onClick={beginDrawing}>{selected() ? 'Replace ROI' : 'Draw ROI'}</Button>}
          <Button className="rispro-roi-action" size="sm" variant="secondary" disabled={!selected() || isDrawing} onClick={deleteRoi}
            onPointerDown={event => { if (event.pointerType === 'touch') deletePress.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }}
            onPointerCancel={() => { deletePress.current = null; }}
            onPointerUp={event => {
              const press = deletePress.current; deletePress.current = null;
              if (event.pointerType !== 'touch' || press?.id !== event.pointerId || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
              event.preventDefault(); deleteRoi();
            }}>Delete ROI</Button>
        </div>
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
        <p className="mt-1 text-xs">Drag to navigate after drawing; select an ROI boundary to edit. Signal only; no motion correction.</p>
      </section>}
  </div>;
}
