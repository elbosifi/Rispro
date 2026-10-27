// Extend OHIF's existing thumbnail touch handling. Browser-synthesized clicks
// can disappear when a loading thumbnail changes during a tap. Image-viewport
// gestures remain entirely Cornerstone-owned.
export function thumbnailTouchHandlers(gesture, onClick, isCoarse) {
  const point = event => Array.from(event.changedTouches).find(t => t.identifier === gesture.current?.id);
  const moved = (start, end) => !end || Math.hypot(end.clientX - start.x, end.clientY - start.y) > 10;
  return {
    onTouchStart(event) {
      gesture.current = null;
      if (!isCoarse() || event.touches.length !== 1 ||
          event.target.closest('button, a, input, [role="menuitem"]')) return;
      const touch = event.touches[0];
      gesture.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    },
    onTouchMove(event) {
      if (gesture.current && (event.touches.length !== 1 || moved(gesture.current, point(event)))) {
        gesture.current = null;
      }
    },
    onTouchCancel() { gesture.current = null; },
    onTouchEnd(event) {
      if (!isCoarse()) return false;
      const start = gesture.current, end = point(event);
      gesture.current = null;
      if (start && event.touches.length === 0 && !moved(start, end)) {
        // Only a recognized tap suppresses the duplicate compatibility click.
        // Scrolls, multi-touch and menu controls retain native browser behavior.
        event.preventDefault();
        onClick(event);
      }
      return true;
    },
  };
}
