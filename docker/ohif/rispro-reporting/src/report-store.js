// In-memory state belongs to this viewer tab and survives closing its panel.
// No clinical text or image bytes are written to local/session storage.
export function createReportStore({ contextId, captureViewport, locateSource, fetcher = fetch }) {
  let state = { context: null, report: null, text: null, dirty: false, saving: false, busy: false, error: '', conflict: false, history: null, pendingCapture: null, captionEdits: {}, addendumText: '' };
  let chain = Promise.resolve(), timer, generation = 0;
  let finalizeId=newId(),addendumId=newId(),creationId=newId();
  const listeners = new Set();
  const patch = update => { state = { ...state, ...update }; listeners.forEach(fn => fn()); };
  const base = () => state.context?.v2 && state.report ? '/api/native-reporting/reports/'+state.report.id : '/api/native-reporting/appointments/' + state.context.appointmentId;
  const request = async (url, method = 'GET', body, extra = {}) => {
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),body instanceof Blob?90000:15000);
    try{const response = await fetcher(url, { method, credentials: 'same-origin', cache: 'no-store', signal:controller.signal,
      headers: { 'X-RISpro-Viewer-Context': contextId, ...(body instanceof Blob ? {} : { 'Content-Type': 'application/json' }), ...extra },
      ...(body === undefined ? {} : { body: body instanceof Blob ? body : JSON.stringify(body) }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error?.message || payload.message || `Reporting request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
    }catch(error){if(controller.signal.aborted)throw new Error('Reporting request timed out. Keep this tab open and retry.');throw error;}
    finally{clearTimeout(deadline);}
  };
  const failed = error => { patch({ error: error.message, conflict: error.status === 409 || state.conflict,
    ...(error.status === 401 || error.status === 403 ? { context: { ...state.context, canEdit: false, canFinalize: false, blockedReason: error.message } } : {}) }); throw error; };
  const serial = work => {
    const result = chain.then(work);
    chain = result.catch(() => undefined);
    return result;
  };
  async function save() {
    clearTimeout(timer);
    return serial(async () => {
      if (state.conflict) throw new Error('Reload the saved report to resolve this conflict. Your text is retained until you choose to discard it.');
      if (!state.dirty) return;
      const submitted = generation;
      patch({ saving: true, error: '' });
      try {
        const report = await request(base() + '/draft', 'PUT', { expectedRevision: state.report.revision, sections: state.text });
        patch({ report, dirty: generation !== submitted });
      } catch (error) { failed(error); } finally { patch({ saving: false }); }
    });
  }
  async function flush() {
    do { await save(); } while (state.dirty);
    await serial(async()=>{
      const submitted={...state.captionEdits};
      if(!Object.keys(submitted).length)return;
      if(state.conflict)throw new Error('Resolve the report conflict before saving captions.');
      patch({saving:true});
      try{
        const report=await request(base()+'/images','PUT',{expectedRevision:state.report.revision,images:state.report.keyImages.map(i=>({id:i.id,caption:submitted[i.id]??i.caption}))});
        const remaining={...state.captionEdits};for(const [id,value] of Object.entries(submitted))if(remaining[id]===value)delete remaining[id];
        patch({report,captionEdits:remaining,error:''});
      }catch(error){failed(error);}finally{patch({saving:false});}
    });
    await chain;
  }
  async function mutate(path, body, method = 'POST') {
    await flush();
    return serial(async () => {
      try {
        const report = await request(base() + path, method, { ...(typeof body==='function'?body():body), expectedRevision: state.report.revision });
        patch({ report, error: '' }); return report;
      } catch (error) { return failed(error); }
    });
  }
  async function busy(work) {
    if (state.busy) return;
    patch({ busy: true });
    try { return await work(); } catch (error) { if (!state.error) patch({error:error.message}); throw error; }
    finally { patch({ busy: false }); }
  }
  const store = {
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => state,
    async load() {
      const context = await request('/api/native-reporting/contexts/' + contextId);
      patch({ context, report: context.report, text: context.report?.sections ?? null, dirty: false, conflict: false, error: '', captionEdits: {}, pendingCapture: null });
      return context;
    },
    async create(options={}) {
      return busy(async () => {
        const report = await request(state.context.v2?'/api/native-reporting/workspace/studies/'+encodeURIComponent(state.context.studyKey)+'/reports':base(), 'POST', state.context.v2?{mode:options.mode||'independent',reportType:options.reportType||'primary',requestId:creationId}:{});
        creationId=newId();finalizeId=newId();
        patch({report,text:report.sections,error:'',...(state.context.v2?{context:{...state.context,reports:[...(state.context.reports||[]),report],canEdit:report.canEdit,canFinalize:report.canFinalize}}:{})});
      });
    },
    async selectReport(id) {
      return busy(async()=>{
        await flush();
        const report=await request('/api/native-reporting/reports/'+id);
        generation++;finalizeId=newId();addendumId=newId();
        patch({report,text:report.sections,dirty:false,error:'',conflict:false,history:null,captionEdits:{},addendumText:'',context:{...state.context,canEdit:report.canEdit,canFinalize:report.canFinalize}});
      });
    },
    edit(name, value) {
      generation++;
      patch({ text: { ...state.text, [name]: value }, dirty: true });
      clearTimeout(timer);
      if (!state.error && !state.conflict) timer = setTimeout(() => save().catch(() => undefined), 1000);
    },
    save: flush,
    finalize(requestId=finalizeId) {
      return busy(async () => {
        if (state.pendingCapture) throw new Error('Retry or discard the pending key-image upload before signing.');
        return mutate('/finalize', { requestId, confirmed: true,...(state.context.v2?{signerUserId:state.context.signerUserId}:{}) });
      });
    },
    addendum: (text, requestId=addendumId) => busy(async () => {const result=await mutate('/addenda', { text, requestId, confirmed: true });addendumId=newId();if(state.addendumText===text)patch({addendumText:''});return result;}),
    editAddendum: text => patch({addendumText:text}),
    editCaption: (id,text) => patch({captionEdits:{...state.captionEdits,[id]:text}}),
    async capture() {
      return busy(async () => {
        if (!state.context?.canEdit || !['draft','in_review'].includes(state.report?.status)) throw new Error('Create an editable report draft before adding a key image.');
        if (state.pendingCapture) throw new Error('Retry or discard the pending upload first.');
        await flush();
        const captured = await captureViewport();
        patch({ pendingCapture: { ...captured, requestId: newId(), expectedRevision: state.report.revision } });
        await store.retryCapture();
      });
    },
    async retryCapture() {
      return serial(async () => {
        const capture = state.pendingCapture;
        if (!capture) return;
        try {
          const report = await request(base() + '/images', 'POST', capture.blob, {
            'Content-Type': 'image/png', 'X-RISpro-Capture': encodeURIComponent(JSON.stringify({ expectedRevision: capture.expectedRevision, requestId: capture.requestId, provenance: capture.provenance })) });
          patch({ report, pendingCapture: null, error: '' });
        } catch (error) { return failed(error); }
      });
    },
    discardCapture() { patch({pendingCapture:null}); },
    images: selected => busy(() => mutate('/images', () => ({ images: selected.map(i=>({id:i.id,caption:state.report.keyImages.find(current=>current.id===i.id)?.caption || ''})) }), 'PUT')),
    async history() { const history = await request(base() + '/history'); patch({history:Array.isArray(history)?history:history.versions}); },
    locate: image => locateSource(image.provenance),
    imageUrl: image => base() + '/images/' + image.id,
    printUrl: () => base() + '/print',
    setError: error => patch({error:error.message || String(error)}),
    destroy() { clearTimeout(timer); listeners.clear(); },
    hasUnsaved: () => state.dirty || state.saving || state.busy || !!state.pendingCapture || !!state.addendumText || Object.keys(state.captionEdits).length>0,
  };
  return store;
}
// crypto.randomUUID is unavailable on an ordinary HTTP LAN. getRandomValues works there.
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
