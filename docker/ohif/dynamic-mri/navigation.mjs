// Wrap the existing instance only while its eligible viewport is active.
// The volume remains the sole owner of the 1-based phase index.
export function installPhaseNavigation({ element, viewportId, toolGroup, volume, interacting = () => false }) {
  const tool = toolGroup?.getToolInstance('StackScroll');
  if (!tool) return () => {};
  const original = tool.mouseDragCallback;
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
  function drag(event) {
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
  }
  tool.mouseDragCallback = drag;
  const wheel = event => {
    if (!active() || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) < 1 || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.3) return;
    // DOM_DELTA_LINE/PAGE devices are normalized locally; ordinary vertical wheel is untouched.
    change(event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1));
    event.preventDefault(); event.stopImmediatePropagation();
  };
  element.addEventListener('wheel', wheel, { capture: true, passive: false });
  const ends = ['mouseup', 'pointercancel', 'touchcancel', 'blur'];
  const target = element.ownerDocument.defaultView;
  ends.forEach(name => target.addEventListener(name, reset));
  return () => {
    alive = false; reset();
    if (tool.mouseDragCallback === drag) tool.mouseDragCallback = original;
    element.removeEventListener('wheel', wheel, true);
    ends.forEach(name => target.removeEventListener(name, reset));
  };
}
