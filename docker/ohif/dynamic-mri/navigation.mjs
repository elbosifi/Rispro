import { roiPlane, samePlane } from './analysis.mjs';

// Wrap the existing instance only while its eligible viewport is active.
// The volume remains the sole owner of the 1-based phase index.
export function installPhaseNavigation({ element, viewportId, toolGroup, volume, interacting = () => false }) {
  const tool = toolGroup?.getToolInstance('StackScroll');
  if (!tool) return () => {};
  const originals = { mouseDragCallback: tool.mouseDragCallback, touchDragCallback: tool.touchDragCallback };
  let alive = true, direction, carry = 0, last;
  const reset = () => { direction = undefined; carry = 0; last = undefined; };
  const active = () => alive && !interacting() && toolGroup.getActivePrimaryMouseButtonTool() === 'StackScroll';
  const change = pixels => {
    carry += pixels;
    const steps = Math.trunc(carry / 25);
    if (!steps) return;
    carry -= steps * 25;
    volume.dimensionGroupNumber = Math.max(1, Math.min(volume.numDimensionGroups, volume.dimensionGroupNumber + steps));
  };
  const wrap = (original, touch) => function drag(event) {
    if (touch && event.detail.event?.touches?.length !== 1) { reset(); return original.call(this, event); }
    if (event.detail.viewportId !== viewportId || !active()) { reset(); return original.call(this, event); }
    const { startPoints, currentPoints, deltaPoints } = event.detail;
    const start = startPoints?.canvas, current = currentPoints?.canvas;
    if (!start || !current) return original.call(this, event);
    const dx = current[0] - start[0], dy = current[1] - start[1];
    if (!direction) {
      if (Math.hypot(dx, dy) < 8) return;
      direction = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'horizontal' : 'vertical';
      last = current;
      if (direction === 'horizontal') { change(dx); return; }
      // Replay the accumulated vertical distance, then leave upstream unchanged.
      return original.call(this, { ...event, detail: { ...event.detail, deltaPoints: { ...deltaPoints, canvas: [dx, dy] } } });
    }
    if (direction === 'vertical') return original.call(this, event);
    change(current[0] - last[0]); last = current;
  };
  const callbacks = {};
  for (const [name, original] of Object.entries(originals)) {
    if (typeof original !== 'function') continue;
    callbacks[name] = tool[name] = wrap(original, name === 'touchDragCallback');
  }
  const wheel = event => {
    if (!active() || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) < 1 || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.3) return;
    // DOM_DELTA_LINE/PAGE devices are normalized locally; ordinary vertical wheel is untouched.
    change(event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1));
    event.preventDefault(); event.stopImmediatePropagation();
  };
  element.addEventListener('wheel', wheel, { capture: true, passive: false });
  const ends = ['mouseup', 'pointerup', 'pointercancel', 'touchend', 'touchcancel', 'blur'];
  const target = element.ownerDocument.defaultView;
  ends.forEach(name => target.addEventListener(name, reset));
  return () => {
    alive = false; reset();
    for (const [name, callback] of Object.entries(callbacks)) if (tool[name] === callback) tool[name] = originals[name];
    element.removeEventListener('wheel', wheel, true);
    ends.forEach(name => target.removeEventListener(name, reset));
  };
}


// Native volume annotations can render across phases. Restrict only the selected
// curve ROI to its verified source plane; leave all other annotations untouched.
export function curveRoiOnPlane(context, annotation, viewport) {
  try {
    const plane = roiPlane(context, annotation), camera = viewport.getCamera();
    const current = context.frames.flat().find(frame => frame.id === viewport.getCurrentImageId());
    const phaseFrame = plane.frames[context.volume.dimensionGroupNumber - 1];
    if (!current || !samePlane(current.geometry, phaseFrame?.geometry)) return false;
    const normal = plane.reference.geometry.normal;
    const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    return Math.abs(Math.abs(dot(normal, camera.viewPlaneNormal)) - 1) <= 1e-4 &&
      Math.abs(dot(camera.focalPoint.map((value, i) => value - plane.center[i]), normal)) <= 0.1;
  } catch { return false; }
}

export function installCurveRoiVisibility({ element, toolGroup, context, getViewport, getSelected }) {
  const tool = toolGroup?.getToolInstance('EllipticalROI');
  if (!tool) return () => {};
  const original = tool.filterInteractableAnnotationsForElement;
  function filter(target, annotations) {
    if (target !== element) return original.call(this, target, annotations);
    const selected = getSelected();
    const remaining = annotations?.filter(annotation => annotation !== selected) || [];
    const result = original.call(this, target, remaining);
    if (selected && annotations?.includes(selected) && selected.isVisible !== false && curveRoiOnPlane(context, selected, getViewport())) result.push(selected);
    return result;
  }
  tool.filterInteractableAnnotationsForElement = filter;
  return () => { if (tool.filterInteractableAnnotationsForElement === filter) tool.filterInteractableAnnotationsForElement = original; };
}
