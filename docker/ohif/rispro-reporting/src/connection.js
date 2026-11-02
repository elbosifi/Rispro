// One controller per page. Selectors and all credentials remain in HttpOnly
// cookies; no clinical state is persisted or passed between tabs.
export function createConnection({ contextId, fetcher = fetch, target = window, now = Date.now, random = Math.random, wait, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let state = { status: 'connected', message: '' }, renewal, authentication, userId, stopped = false;
  let lastActive = now(), lastRenewed = 0, interval, authorizationEpoch=0, removeListeners;
  let recoveryTimer, recoveryDue=0, probeAttempt=0, lastProbe=-Infinity, probing=false, degraded=false, recoveryRequested=false;
  const listeners = new Set(), reads = new Map(), failedReads = new Set(), wakeWaiters = new Set(), pending = new Set(), requests = new Set(), readCancels = new Set();
  const canceled = () => new DOMException('Viewer closed or request canceled.', 'AbortError');
  const cancelRecovery = () => { clearTimer(recoveryTimer); recoveryTimer=undefined; };
  const resumeReads = () => { for(const resume of [...wakeWaiters])resume(); };
  // Cancellation releases suspended/obsolete reads, including those waiting for
  // login. It never changes a successful cache entry or replays a report write.
  const cancellable = (promise,signal) => new Promise((resolve,reject)=>{
    const finish=(fn,value)=>{pending.delete(abort);signal?.removeEventListener('abort',onAbort);fn(value);};
    const abort=reason=>finish(reject,reason),onAbort=()=>abort(canceled());
    pending.add(abort);signal?.addEventListener('abort',onAbort,{once:true});
    if(stopped || signal?.aborted)onAbort();
    Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
  const sleep = (ms,signal) => {
    if(wait)return cancellable(wait(ms),signal);
    let timer;
    return cancellable(new Promise(resolve=>{timer=setTimer(resolve,ms);}),signal).finally(()=>clearTimer(timer));
  };
  const patch = update => {
    // Logout/revocation is terminal for this page, including late network or
    // heartbeat completions. Only a newly authorized viewer may replace it.
    if(state.status==='denied' && update.status && update.status!=='denied')return;
    state = { ...state, ...update }; listeners.forEach(fn => fn());
  };
  const request = async (url, body) => {
    const controller = new AbortController(), timer = setTimer(() => controller.abort(), 60000);
    requests.add(controller);
    try {
      const response = await fetcher(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error?.message || 'Connection unavailable.'), { status: response.status, code: payload.error?.details?.code });
      return payload;
    } finally { clearTimer(timer);requests.delete(controller); }
  };
  const failure = error => {
    if (error.status === 401 && ['AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(error.code)) patch({ status: 'authentication-required', message: 'Sign in as the original viewer user to continue.' });
    else if ([401,403,404,409].includes(error.status)) { authorizationEpoch++;patch({ status: 'denied', message: error.message }); }
    else patch({ status: 'reconnecting', message: 'Connection interrupted. Loaded images and unsaved work are retained.' });
    if(state.status==='denied' || state.status==='authentication-required')cancelRecovery();
    if(state.status==='denied'){
      for(const cancel of readCancels)cancel();
      for(const reject of [...pending])reject(Object.assign(new Error(state.message),{status:403}));
      for(const request of requests)request.abort();
    }
    return error;
  };
  const recoveryAllowed = () => !stopped && !['denied','authentication-required'].includes(state.status);
  function scheduleRecovery(immediate=false) {
    if(!recoveryAllowed() || probing)return;
    const backoff=Math.min(60000,1000*2**Math.min(probeAttempt,6));
    const delay=immediate?Math.max(0,lastProbe+1000-now()):online()?Math.min(60000,backoff*(0.75+random()*0.5)):60000;
    // Focus/visibility/online storms can expedite one probe, never add another.
    if(recoveryTimer!==undefined && recoveryDue<=now()+delay)return;
    cancelRecovery();recoveryDue=now()+delay;
    recoveryTimer=setTimer(async()=>{
      recoveryTimer=undefined;
      if(!recoveryAllowed())return;
      if(!online()){scheduleRecovery();return;}
      probing=true;lastProbe=now();probeAttempt++;
      try{await renew();}catch{}finally{
        probing=false;
        if(recoveryRequested || failedReads.size)scheduleRecovery();
      }
    },delay);
    recoveryTimer?.unref?.();
  }
  async function renew() {
    if(stopped)throw canceled();
    if (state.status === 'denied') throw Object.assign(new Error(state.message), { status: 403 });
    if (renewal) return renewal;
    const epoch=authorizationEpoch;
    renewal = (async () => {
      try {
        const result = await request('/api/ohif/contexts/' + contextId + '/renew');
        if (userId != null && Number(result.userId) !== Number(userId)) throw Object.assign(new Error('The viewer user changed.'), { status: 403 });
        userId = result.userId;
        await request('/api/auth/refresh');
        if(stopped)throw canceled();
        if(epoch!==authorizationEpoch || state.status==='denied')throw Object.assign(new Error('Viewer access was stopped.'),{status:403});
        lastRenewed = now();
        recoveryRequested=false;
        if(!failedReads.size)cancelRecovery();
        patch({ status: failedReads.size?'reconnecting':'connected', message: '' });
        const signedIn=authentication;authentication=null;signedIn?.resolve();
        resumeReads();
        return result;
      } catch (error) {
        if(stopped)throw error;
        failure(error);
        if(state.status==='reconnecting')recoveryRequested=true;
        throw error;
      }
      finally { renewal = null;if(recoveryRequested)scheduleRecovery(); }
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
  const waitForWake = signal => {
    let resume;
    const promise=cancellable(new Promise(resolve=>{resume=resolve;wakeWaiters.add(resume);}),signal).finally(()=>wakeWaiters.delete(resume));
    scheduleRecovery();return promise;
  };
  async function ready(signal) {
    if (state.status === 'denied') throw Object.assign(new Error(state.message), { status: 403 });
    if (state.status === 'authentication-required') await cancellable(awaitLogin(),signal);
    while (!online() && !stopped) { patch({ status: 'reconnecting' }); await waitForWake(signal); }
    if(stopped || signal?.aborted)throw canceled();
    if(state.status==='denied')throw Object.assign(new Error(state.message),{status:403});
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
    read(key, work, signal, cancel) {
      if (reads.has(key)) return reads.get(key);
      if(cancel)readCancels.add(cancel);
      const pending = (async () => {
        let attempt = 0, authenticationRetried=false;
        while (!stopped) {
          await ready(signal);
          if (stopped || signal?.aborted) throw canceled();
          try {
            const result = await cancellable(work(),signal);
            failedReads.delete(key);
            if(!failedReads.size && !recoveryRequested){degraded=false;probeAttempt=0;cancelRecovery();if(state.status==='reconnecting')patch({status:'connected',message:''});}
            return result;
          }
          catch (error) {
            if (signal?.aborted || error.name === 'AbortError') throw error;
            const status = Number(error.status ?? error.request?.status ?? 0);
            if (status === 401 || status === 403) {
              if(authenticationRetried && now()-lastRenewed<60000){throw failure(Object.assign(new Error('Image access denied after session renewal.'),{status:403}));}
              // Nginx auth_request can strip JSON codes. Probe the authenticated
              // renewal endpoint to distinguish expiry from actual denial.
              let validated=false;
              try { await renew();authenticationRetried=true;validated=true; } catch (authError) {
                if (state.status === 'authentication-required') { await cancellable(awaitLogin(),signal);authenticationRetried=true;continue; }
                if (state.status === 'denied') throw authError;
              }
              if (status === 403 && validated) throw failure(Object.assign(new Error(error.message || 'Image access denied.'),{status:403}));
            } else if (status ? ![502,503,504].includes(status) : !(error instanceof TypeError || 'status' in error || error.request || /network|connection|fetch|reset|timeout|timed out/i.test(error.message || ''))) throw error;
            patch({ status: 'reconnecting' });
            failedReads.add(key);
            // One tab-owned scheduler probes authorization while degraded.
            // Each successful probe releases only suspended failed reads once;
            // a frame-only outage cannot restart a four-download burst.
            if (degraded || ++attempt >= 4) { degraded=true;await waitForWake(signal);attempt=0; }
            else await sleep(1000 * 2 ** (attempt - 1) * (0.75 + random() * 0.5),signal);
          }
        }
        throw new DOMException('Viewer closed', 'AbortError');
      })().finally(() => { reads.delete(key);failedReads.delete(key);readCancels.delete(cancel);if(!failedReads.size){degraded=false;if(!recoveryRequested)cancelRecovery();} });
      reads.set(key, pending);
      return pending;
    },
    retry() { if(recoveryAllowed() && (state.status==='reconnecting' || failedReads.size || wakeWaiters.size))scheduleRecovery(true); },
    notify(error) {
      failure(error);
      if(state.status==='reconnecting'){recoveryRequested=true;scheduleRecovery();}
    },
    start() {
      if(removeListeners)return stop;
      stopped=false;
      const active = () => { lastActive = now(); };
      const check = () => { if(state.status==='reconnecting'){scheduleRecovery();return;}if(online() && state.status==='connected' && now()-lastActive<30*60000 && now()-lastRenewed>=10*60000)renew().catch(()=>{}); };
      const focus = () => { lastActive=now();if(!recoveryAllowed())return;if(state.status==='reconnecting')scheduleRecovery(true);else if(online() && now()-lastProbe>=1000){lastProbe=now();renew().catch(()=>{});} };
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
      removeListeners=()=>{clearInterval(interval);channel?.close();events.forEach(([name,fn])=>target.removeEventListener(name,fn));target.document?.removeEventListener('visibilitychange',visibility);};
      return stop;
    },
    destroy: stop,
  };
  function stop() {
    stopped=true;authorizationEpoch++;cancelRecovery();removeListeners?.();removeListeners=null;
    for(const cancel of readCancels)cancel();
    for(const request of requests)request.abort();
    for(const reject of [...pending])reject(canceled());
    authentication?.reject(canceled());authentication=null;listeners.clear();
  }
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
