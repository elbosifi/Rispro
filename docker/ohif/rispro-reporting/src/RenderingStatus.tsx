import React, { useSyncExternalStore } from 'react';
import { Button } from '@ohif/ui-next';

export default function RenderingStatus({ recovery }) {
  const state = useSyncExternalStore(recovery.subscribe, recovery.getSnapshot);
  if (!state) return null;
  return <div className="fixed bottom-2 left-2 z-[90] max-w-md rounded bg-black p-3 text-white" role="alert" aria-label="Rendering recovery">
    <p>{state.message}</p>
    <Button disabled={state.busy} onClick={() => recovery.retry()}>Retry rendering</Button>
    {!state.busy && (recovery.canStack() ? <Button onClick={() => recovery.openStack()}>Open in 2D stack</Button>
      : <p>A safe 2D fallback is unavailable for this layout or phase mapping.</p>)}
    {!state.busy && <Button asChild><a href="/doctor" target="_blank" rel="noopener noreferrer">Reopen study</a></Button>}
  </div>;
}
