import React, { useState, useSyncExternalStore } from 'react';
import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@ohif/ui-next';

// OHIF is a separate build: use its existing primitives, not RISpro's Vite UI.
export default function ConnectionDialog({ connection }) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  const login = async event => {
    event.preventDefault(); setBusy(true);
    const submitted = password; setPassword('');
    try { await connection.login(username, submitted); } catch {} finally { setBusy(false); }
  };
  if (state.status === 'connected') return null;
  if (state.status === 'reconnecting') return <div className="fixed bottom-2 left-2 z-[100] rounded bg-black p-3 text-white" role="status">
    Reconnecting. Loaded images and unsaved work are retained. <Button onClick={() => connection.retry()}>Retry connection</Button>
  </div>;
  return <Dialog open onOpenChange={() => {}}><DialogContent className="w-[calc(100vw-24px)] max-w-md text-white" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
    <DialogHeader><DialogTitle>{state.status === 'denied' ? 'Viewer access stopped' : 'Authentication required'}</DialogTitle>
      <DialogDescription className="text-white">{state.message} Keep this tab open to retain unsaved work.</DialogDescription></DialogHeader>
    {state.status === 'authentication-required' && <form onSubmit={login} onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}>
      <label className="mb-2 block">Username<Input className="text-white" autoFocus autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></label>
      <label className="mb-2 block">Password<Input className="text-white" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>}
  </DialogContent></Dialog>;
}
