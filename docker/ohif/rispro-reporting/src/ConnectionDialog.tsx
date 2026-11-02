import React, { useState, useSyncExternalStore } from 'react';
import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@ohif/ui-next';

// OHIF is a separate build: use its existing primitives, not RISpro's Vite UI.
export default function ConnectionDialog({ connection }) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const login = async event => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget, values = new FormData(form);
    setBusy(true);
    const clearPassword = () => { const input = form.elements.namedItem('password') as HTMLInputElement; if (input) input.value = ''; };
    try {
      await connection.login(String(values.get('username') || ''), String(values.get('password') || ''));
      clearPassword();
    } catch (error) {
      if (error.authenticated) clearPassword();
      else (form.elements.namedItem('password') as HTMLInputElement)?.focus();
    } finally { setBusy(false); }
  };
  if (state.status === 'connected') return null;
  if (state.status === 'denied' && reviewing) return <div className="fixed bottom-2 left-2 z-[100] max-w-md rounded bg-black p-3 text-white" role="status">
    Viewer access has ended. Loaded images and unsaved work remain in this tab.
    <Button asChild><a href="/doctor" target="_blank" rel="noopener noreferrer">Reopen study</a></Button>
  </div>;
  if (state.status === 'reconnecting') return <div className="fixed bottom-2 left-2 z-[100] rounded bg-black p-3 text-white" role="status">
    {state.message || 'Reconnecting. Loaded images and unsaved work are retained.'} <Button onClick={() => connection.retry()}>Retry connection</Button>
  </div>;
  return <Dialog open onOpenChange={() => {}}><DialogContent className="w-[calc(100vw-24px)] max-w-md text-white" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
    <DialogHeader><DialogTitle>{state.code === 'VIEWER_LOGGED_OUT' ? 'Viewer session ended by logout' : state.status === 'denied' ? 'Viewer access stopped' : 'Session expired'}</DialogTitle>
      <DialogDescription className="text-white">{!state.stage && state.message} Keep this tab open to retain unsaved work.</DialogDescription></DialogHeader>
    {state.stage && <p role="alert">{state.message}</p>}
    {state.status === 'authentication-required' && <form method="post" onSubmit={login} onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}>
      <label htmlFor="rispro-viewer-username" className="mb-2 block">Username</label>
      <Input id="rispro-viewer-username" name="username" type="text" className="mb-2 text-white" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      <label htmlFor="rispro-viewer-password" className="mb-2 block">Password</label>
      <Input id="rispro-viewer-password" name="password" className="mb-2 text-white" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>}
    {state.status === 'denied' && <><p>Sign in to RISpro and select this study again. Access is checked again for a new viewer session. Unsaved work stays in this tab; review or copy it before closing.</p>
      <Button asChild><a href="/doctor" target="_blank" rel="noopener noreferrer">Reopen study</a></Button>
      <Button onClick={() => setReviewing(true)}>Review unsaved work</Button></>}
  </DialogContent></Dialog>;
}
