// One controller per page. Selectors and all credentials remain in HttpOnly
// cookies; no clinical state is persisted or passed between tabs.
export function createConnection({ contextId, fetcher = fetch, target = window, now = Date.now, random = Math.random, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  let state = { status: 'connected', message: '' }, renewal, authentication, userId, stopped = false, recovery;
  let lastActive = now(), lastRenewed = 0, interval, wake, authorizationEpoch=0;
  const listeners = new Set(), reads = new Map();
  const patch = update => {
    // Logout/revocation is terminal for this page, including late network or
    // heartbeat completions. Only a newly authorized viewer may replace it.
    if(state.status==='denied' && update.status && update.status!=='denied')return;
    state = { ...state, ...update }; listeners.forEach(fn => fn());
  };
  const request = async (url, body) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetcher(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error?.message || 'Connection unavailable.'), { status: response.status, code: payload.error?.details?.code });
      return payload;
    } finally { clearTimeout(timer); }
  };
  const failure = error => {
    if (error.status === 401 && ['AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(error.code)) patch({ status: 'authentication-required', message: 'Sign in as the original viewer user to continue.' });
    else if ([401,403,404,409].includes(error.status)) { authorizationEpoch++;patch({ status: 'denied', message: error.message }); }
    else patch({ status: 'reconnecting', message: 'Connection interrupted. Loaded images and unsaved work are retained.' });
    return error;
  };
  async function renew() {
    if (state.status === 'denied') throw Object.assign(new Error(state.message), { status: 403 });
    if (renewal) return renewal;
    const epoch=authorizationEpoch;
    renewal = (async () => {
      try {
        const result = await request('/api/ohif/contexts/' + contextId + '/renew');
        if (userId != null && Number(result.userId) !== Number(userId)) throw Object.assign(new Error('The viewer user changed.'), { status: 403 });
        userId = result.userId;
        await request('/api/auth/refresh');
        if(epoch!==authorizationEpoch || state.status==='denied')throw Object.assign(new Error('Viewer access was stopped.'),{status:403});
        lastRenewed = now();
        patch({ status: 'connected', message: '' });
        return result;
      } catch (error) { throw failure(error); }
      finally { renewal = null; }
    })();
    return renewal;
  }
  const awaitLogin = () => {
    if (!authentication) {
      let resolve, reject;
      const promise = new Promise((a,b) => { resolve = a; reject = b; });
      authentication = { promise, resolve, reject };
    }
    return authentication.promise;
  };
  const online = () => target.navigator?.onLine !== false;
  const waitForWake = signal => new Promise((resolve,reject) => {
    const previous = wake;
    const abort = () => { signal?.removeEventListener('abort',abort); reject(new DOMException('Canceled','AbortError')); };
    wake = () => { previous?.(); signal?.removeEventListener('abort',abort); resolve(); };
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
  async function ready(signal) {
    if (state.status === 'denied') throw Object.assign(new Error(state.message), { status: 403 });
    if (state.status === 'authentication-required') await awaitLogin();
    while (!online() && !stopped) { patch({ status: 'reconnecting' }); await waitForWake(signal); }
    if (stopped) throw Object.assign(new Error('Viewer closed.'), { name: 'AbortError' });
  }
  const controller = {
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => state,
    renew,
    async login(username, password) {
      try {
        const result = await request('/api/auth/login', { username, password, viewerContextId: contextId });
        if (userId != null && Number(result.user.id) !== Number(userId)) throw Object.assign(new Error('Sign in as the original viewer user.'), { status: 403 });
        await renew();
        if(target.BroadcastChannel){const channel=new target.BroadcastChannel('rispro-session');channel.postMessage({type:'session-changed'});channel.close();}
        const pending = authentication; authentication = null; pending?.resolve();
        controller.retry();
      } catch (error) { patch({ message: error.message }); throw error; }
    },
    // Only callers implementing DICOM GETs may use this. No report mutations.
    read(key, work, signal) {
      if (reads.has(key)) return reads.get(key);
      const pending = (async () => {
        let attempt = 0;
        while (!stopped) {
          await ready(signal);
          if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
          try { const result = await work(); if (state.status === 'reconnecting') patch({ status: 'connected', message: '' }); return result; }
          catch (error) {
            if (signal?.aborted || error.name === 'AbortError') throw error;
            const status = Number(error.status ?? error.request?.status ?? 0);
            if (status === 401 || status === 403) {
              // Nginx auth_request can strip JSON codes. Probe the authenticated
              // renewal endpoint to distinguish expiry from actual denial.
              try { await renew(); } catch (authError) {
                if (state.status === 'authentication-required') { await awaitLogin(); continue; }
                if (state.status === 'denied') throw authError;
              }
              if (status === 403 && state.status === 'connected') { failure(Object.assign(error,{status:403})); throw error; }
            } else if (status ? ![502,503,504].includes(status) : !(error instanceof TypeError || 'status' in error || error.request || /network|connection|fetch|reset|timeout|timed out/i.test(error.message || ''))) throw error;
            patch({ status: 'reconnecting' });
            // Four bounded automatic attempts, then wait for explicit Retry or
            // an online event. Keep the original OHIF promise alive throughout.
            if (++attempt >= 4) { await waitForWake(signal); attempt = 0; }
            else await wait(Math.min(30000, 1000 * 2 ** (attempt - 1)) * (0.75 + random() * 0.5));
          }
        }
        throw new DOMException('Viewer closed', 'AbortError');
      })().finally(() => reads.delete(key));
      reads.set(key, pending);
      return pending;
    },
    retry() { const resume = wake; wake = null; resume?.(); if (state.status !== 'denied' && state.status !== 'authentication-required') renew().catch(() => {}); },
    notify(error) {
      failure(error);
      if(!recovery && state.status==='reconnecting'){
        recovery=(async()=>{
          for(let attempt=0;attempt<4 && !stopped;attempt++){
            await wait(Math.min(30000,1000*2**attempt)*(0.75+random()*0.5));
            if(!online())continue;
            try { await renew();return; } catch { if(state.status!=='reconnecting')return; }
          }
        })().finally(()=>{recovery=null;});
      }
    },
    start() {
      stopped=false;
      const active = () => { lastActive = now(); };
      const check = () => { if (online() && state.status !== 'authentication-required' && state.status !== 'denied' && now() - lastActive < 30 * 60000 && (state.status==='reconnecting' || now() - lastRenewed >= 10 * 60000)) renew().catch(() => {}); };
      const focus = () => { lastActive = now(); if(online() && state.status!=='authentication-required' && state.status!=='denied')renew().catch(()=>{}); };
      const visibility = () => { if (target.document?.visibilityState === 'visible') focus(); };
      const connected = () => { controller.retry(); check(); };
      const disconnected = () => controller.notify(new TypeError('Network connection unavailable. Work is retained in this tab.'));
      const events = [['pointerdown',active],['keydown',active],['wheel',active],['focus',focus],['online',connected],['offline',disconnected]];
      events.forEach(([name,fn]) => target.addEventListener(name,fn));
      const channel=target.BroadcastChannel?new target.BroadcastChannel('rispro-session'):null;
      if(channel)channel.onmessage=event=>{
        if(event.data?.type==='logout')failure(Object.assign(new Error('RISpro was signed out. Viewer access is stopped; local work is retained.'),{status:403}));
        else if(event.data?.type==='session-changed')renew().catch(()=>{});
      };
      target.document?.addEventListener('visibilitychange', visibility);
      interval = setInterval(check, 60000); check();
      return () => { stopped = true; clearInterval(interval);channel?.close(); events.forEach(([name,fn]) => target.removeEventListener(name,fn)); target.document?.removeEventListener('visibilitychange',visibility); wake?.(); authentication?.reject(new DOMException('Viewer closed','AbortError')); listeners.clear(); };
    },
  };
  return controller;
}

export const connection = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('risproContext')
  ? createConnection({ contextId: new URLSearchParams(window.location.search).get('risproContext') }) : null;

export function protectDicomClient(client) {
  if (!connection || client.risproRecovery) return;
  const get = client._httpGet.bind(client);
  client._httpGet = (url, headers, ...args) => connection.read('metadata:' + url + JSON.stringify(headers), () => get(url, headers, ...args));
  client.risproRecovery = true;
}
