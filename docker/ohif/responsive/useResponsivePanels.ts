import { useEffect } from 'react';

export function useResponsivePanels(setLeftClosed, setRightClosed) {
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    // Close only when crossing into the drawer layout, never on browser-bar
    // movement. The existing panels call their original collapse/resize APIs.
    const update = () => {
      if (media.matches) { setLeftClosed(true); setRightClosed(true); }
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [setLeftClosed, setRightClosed]);

  useEffect(() => {
    const visual = window.visualViewport;
    const root = document.querySelector('.rispro-viewer') as HTMLElement;
    if (!visual || !root) return;
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Browser zoom must remain usable. The keyboard reduces visualViewport
        // on iOS even when dvh/layoutViewport do not change.
        if (visual.scale === 1) root.style.setProperty('--rispro-visual-height', `${visual.height}px`);
      });
    };
    update();
    visual.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); visual.removeEventListener('resize', update); };
  }, []);
}
