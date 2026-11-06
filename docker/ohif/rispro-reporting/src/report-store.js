// In-memory state belongs to this viewer tab and survives closing its panel.
// No clinical text or image bytes are written to local/session storage.
import {emptySections,copySections,templateSelection,templateInput,aiInput,aiTasks,reportFields} from './report-workflow.js';
export function createReportStore({ contextId, captureViewport, locateSource, fetcher = fetch, connection }) {
  const newTemplate=()=>({id:null,name:'',sections:emptySections(),dirty:false,confirmed:false,error:''});
  let state = { context: null, report: null, text: null, dirty: false, saving: false, busy: false, dictationBusy:false, error: '', conflict: false, connection: 'connected', history: null, pendingCapture: null, captionEdits: {}, addendumText: '', templates:null,templateSelection:'blank',templateDraft:newTemplate(),templateBusy:false,templateError:'',templateMessage:'',reviewers:[],reviewEvents:[],reviewLoading:false,reviewComment:'',preferredReviewer:'',ai:{task:'cleanup_dictation',field:'findings',busy:false,health:null,proposal:null,error:''},aiSaveRequired:false };
  let chain = Promise.resolve(), timer, generation = 0, manualSaveRequired = false;
  let uncertain, recovering, destroyed = false, retryCaptions=false;
  let finalizeId=newId(),addendumId=newId(),creationId=newId();
  let aiController,aiSequence=0,templateSequence=0,reviewSequence=0;
  const requests=new Set();
  const listeners = new Set();
  const patch = update => { if(destroyed)return;const context=update.context??state.context;if(update.report&&context?.v2)update={...update,context:{...context,canEdit:update.report.canEdit,canFinalize:update.report.canFinalize,finalizeReasons:update.report.finalizeReasons||[],reports:(context.reports||[]).map(report=>Number(report.id)===Number(update.report.id)?update.report:report)}};state = { ...state, ...update }; listeners.forEach(fn => fn()); };
  const patchAi=update=>patch({ai:{...state.ai,...update}});
  const editable=()=>Boolean((state.report?.canEdit??state.context?.canEdit)&&['draft','in_review'].includes(state.report?.status)&&!state.report?.deletedAt&&state.connection==='connected');
  const scope=()=>JSON.stringify([contextId,state.context?.primaryStudyUid||state.context?.studyKey,state.report?.id]);
  const aiScope=()=>JSON.stringify([scope(),state.report?.revision,generation,editable(),state.conflict]);
  const aiPending=()=>state.ai.busy||Boolean(state.ai.proposal&&!state.ai.proposal.applied);
  function cancelAi(keepProposal=false){aiSequence++;aiController?.abort();aiController=null;patchAi({busy:false,...(!keepProposal?{proposal:null}:{}),error:''});}
  function switchAllowed(){if(state.templateDraft.dirty||state.templateBusy)throw Error('Save or discard template edits before changing reports.');if(state.pendingCapture||state.addendumText)throw Error('Finish the pending key image or unsigned addendum before changing reports.');}
  const base = () => state.context?.v2 && state.report ? '/api/native-reporting/reports/'+state.report.id : '/api/native-reporting/appointments/' + state.context.appointmentId;
  const request = async (url, method = 'GET', body, extra = {}, options = {}) => {
    if(destroyed)throw new Error('Reporting context is closed.');
    const controller=new AbortController(),abort=()=>controller.abort(),deadline=setTimeout(abort,options.timeout??(body instanceof Blob?90000:15000));
    requests.add(controller);options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
    try{const response = await fetcher(url, { method, credentials: 'same-origin', cache: 'no-store', signal:controller.signal,
      headers: { 'X-RISpro-Viewer-Context': contextId, ...(body instanceof Blob ? {} : { 'Content-Type': 'application/json' }), ...extra },
      ...(body === undefined ? {} : { body: body instanceof Blob ? body : JSON.stringify(body) }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error?.message || payload.message || `Reporting request failed (${response.status}).`);
      error.status = response.status;
      error.code = payload.error?.details?.code;
      throw error;
    }
    return response.status===204?undefined:await response.json();
    }catch(error){if(controller.signal.aborted)throw new Error('Reporting request timed out. Keep this tab open and retry.');throw error;}
    finally{clearTimeout(deadline);requests.delete(controller);options.signal?.removeEventListener('abort',abort);}
  };
  const failed = error => {
    patch({ error: error.message, conflict: error.status === 409 || state.conflict });
    if (error.status === 401 || error.status === 403) {
      // A report 403 may be a context expiry, or a permanent permission denial.
      // Only authenticated renewal and a permission read can distinguish them.
      connection?.renew().then(() => store.recover()).catch(() => {});
    } else if (!error.status || error.status >= 500) connection?.notify(error);
    throw error;
  };
  const serial = work => {
    const result = chain.then(work);
    chain = result.catch(() => undefined);
    return result;
  };
  const same = (a,b) => Array.isArray(a) ? JSON.stringify(a)===JSON.stringify(b)
    : !!a && !!b && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(key=>a[key]===b[key]);
  const images = report => report.keyImages.map(i=>({id:i.id,caption:i.caption}));
  function acknowledge(report) {
    if (!uncertain) return;
    const submitted = uncertain;
    const content = submitted.kind === 'text' ? report.sections : images(report);
    if (Number(report.revision) > Number(submitted.revision) && same(content,submitted.content)) {
      if(submitted.kind==='text') {
        patch({dirty:generation!==submitted.generation});
        if(generation===submitted.generation){manualSaveRequired=false;patch({aiSaveRequired:false});}
      } else {
        const remaining={...state.captionEdits};
        for(const [id,value] of Object.entries(submitted.edits))if(remaining[id]===value)delete remaining[id];
        patch({captionEdits:remaining});
      }
    } else if (Number(report.revision) !== Number(submitted.revision)) {
      patch({conflict:true,error:'Another editor changed this report. Local text is retained; resolve the conflict explicitly.'});
    }
    if(submitted.kind==='images' && !Object.keys(state.captionEdits).length)retryCaptions=false;
    uncertain=null;
    patch({report});
  }
  async function reconcile() {
    if(uncertain){const current=await request(base());acknowledge(current.report??current);}
  }
  function schedule() {
    clearTimeout(timer);
    if(!destroyed && ((state.dirty && !manualSaveRequired&&!aiPending())||retryCaptions) && !state.conflict && state.connection==='connected' && (state.report?.canEdit??state.context?.canEdit))
      timer=setTimeout(async()=>{try{if(!manualSaveRequired&&!aiPending())await save();if(retryCaptions)await saveCaptions();}catch{}},1000);
  }
  async function save() {
    clearTimeout(timer);
    return serial(async () => {
      await reconcile();
      if (state.conflict) throw new Error('Reload the saved report to resolve this conflict. Your text is retained until you choose to discard it.');
      if (!state.dirty) return;
      const submitted = generation;
      patch({ saving: true, error: '' });
      uncertain={kind:'text',revision:state.report.revision,content:{...state.text},generation:submitted};
      try {
        const report = await request(base() + '/draft', 'PUT', { expectedRevision: uncertain.revision, sections: uncertain.content });
        uncertain=null;
        patch({ report, dirty: generation !== submitted });
        if(generation===submitted){manualSaveRequired=false;patch({aiSaveRequired:false});}
      } catch (error) { if(error.status && error.status<500)uncertain=null; failed(error); } finally { patch({ saving: false }); }
    });
  }
  async function saveCaptions() {
    return serial(async()=>{
      await reconcile();
      const submitted={...state.captionEdits};
      if(!Object.keys(submitted).length)return;
      if(state.conflict)throw new Error('Resolve the report conflict before saving captions.');
      patch({saving:true});
      retryCaptions=true;
      uncertain={kind:'images',revision:state.report.revision,content:state.report.keyImages.map(i=>({id:i.id,caption:submitted[i.id]??i.caption})),edits:submitted};
      try{
        const report=await request(base()+'/images','PUT',{expectedRevision:uncertain.revision,images:uncertain.content});
        uncertain=null;
        const remaining={...state.captionEdits};for(const [id,value] of Object.entries(submitted))if(remaining[id]===value)delete remaining[id];
        patch({report,captionEdits:remaining,error:''});
        retryCaptions=false;
      }catch(error){if(error.status && error.status<500)uncertain=null;failed(error);}finally{patch({saving:false});}
    });
  }
  async function flush(explicit=false) {
    if(!explicit&&(aiPending()||state.aiSaveRequired&&state.dirty))throw Error('Dismiss the AI proposal and explicitly Save accepted AI changes before this report action.');
    do { await save(); } while (state.dirty);
    await saveCaptions();
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
    if(state.dictationBusy)throw Error('Finish dictation before performing a report action.');
    patch({ busy: true });
    try { return await work(); } catch (error) { if (!state.error) patch({error:error.message}); throw error; }
    finally { patch({ busy: false }); }
  }
  const store = {
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => state,
    async load({reportId=null}={}) { return serial(async()=>{
      const context = await request('/api/native-reporting/contexts/' + contextId);
      const report=reportId&&context.v2?await request('/api/native-reporting/reports/'+reportId):context.report;
      cancelAi();generation++;manualSaveRequired=false;reviewSequence++;
      patch({ context, report, text: report?.sections ?? null, dirty: false, conflict: false, error: '', captionEdits: {}, pendingCapture: null,history:null,reviewEvents:[],reviewers:[],reviewLoading:false,aiSaveRequired:false });
      return context;
    });},
    async recover() {
      if(recovering)return recovering;
      recovering=serial(async()=>{
        try {
          const context=await request('/api/native-reporting/contexts/'+contextId);
          if(state.context?.primaryStudyUid&&context.primaryStudyUid!==state.context.primaryStudyUid)throw Object.assign(Error('The authorized study context changed. Local work is retained.'),{status:403});
          const report=state.report && context.v2 ? await request('/api/native-reporting/reports/'+state.report.id) : context.report;
          if(state.report && (!report || Number(report.id)!==Number(state.report.id)))throw Object.assign(new Error('The report association changed.'),{status:403});
          const previousRevision=state.report?.revision;
          const wasUncertain=!!uncertain;
          if(report)acknowledge(report);
          if(!wasUncertain && (state.dirty||Object.keys(state.captionEdits).length) && previousRevision!==report?.revision)patch({conflict:true,error:'Another editor changed this report. Local text and captions are retained; resolve the conflict explicitly.'});
          patch({context,report,...(!state.dirty?{text:report?.sections??state.text}:{}),...(state.conflict?{}:{error:''})});
          if(!editable())cancelAi(true);
          // Never replay finalize/addendum operations. The capture keeps its
          // original bytes, provenance, request ID and expected revision.
        } catch(error) { failed(error); }
      }).finally(()=>{recovering=null;schedule();});
      return recovering;
    },
    async create(options={}) {
      return busy(async () => {
        switchAllowed();await flush();cancelAi();
        const selected=options.templateSelection||state.templateSelection;
        if(selected.startsWith('personal:')&&!state.templates?.templates.some(t=>'personal:'+t.id===selected))throw Error('The selected personal template is unavailable. Choose another template.');
        const report = await serial(()=>request(state.context.v2?'/api/native-reporting/workspace/studies/'+encodeURIComponent(state.context.studyKey)+'/reports':base(), 'POST', state.context.v2?{mode:options.mode||'independent',reportType:options.reportType||'primary',...templateSelection(selected),requestId:creationId}:{}));
        creationId=newId();finalizeId=newId();
        generation++;reviewSequence++;
        patch({report,text:report.sections,dirty:false,history:null,reviewEvents:[],reviewers:[],reviewLoading:false,reviewComment:'',preferredReviewer:'',error:'',...(state.context.v2?{context:{...state.context,reports:[...(state.context.reports||[]),report],canEdit:report.canEdit,canFinalize:report.canFinalize}}:{})});
      });
    },
    async selectReport(id) {
      return busy(async()=>{
        switchAllowed();await flush();cancelAi();
        const report=await serial(()=>request('/api/native-reporting/reports/'+id));
        generation++;finalizeId=newId();addendumId=newId();
        manualSaveRequired=false;
        reviewSequence++;patch({report,text:report.sections,dirty:false,error:'',conflict:false,history:null,reviewEvents:[],reviewers:[],reviewLoading:false,reviewComment:'',preferredReviewer:'',aiSaveRequired:false,captionEdits:{},addendumText:'',context:{...state.context,canEdit:report.canEdit,canFinalize:report.canFinalize}});
      });
    },
    edit(name, value, {dictated=false,ai=false}={}) {
      if(!editable()||state.busy||state.conflict||!Object.hasOwn(reportFields,name))throw Error('This report section is read only.');
      generation++;
      patch({ text: { ...state.text, [name]: value }, dirty: true });
      clearTimeout(timer);
      if(dictated||ai)manualSaveRequired=true;
      schedule();
    },
    save: ()=>flush(true),
    saveCaptions,
    setDictationBusy:dictationBusy=>patch({dictationBusy}),
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
    async history() { const active=scope(),history = await request(base() + '/history'); if(active===scope())patch({history:Array.isArray(history)?history:history.versions,reviewEvents:history.reviews||[]}); },
    setTemplateSelection(value){templateSelection(value);patch({templateSelection:value});},
    async loadTemplates(){try{const templates=await request('/api/native-reporting/workspace/templates');patch({templates,templateError:''});return templates;}catch(error){patch({templateError:error.message});throw error;}},
    resetTemplate(){templateSequence++;patch({templateDraft:newTemplate(),templateMessage:''});},
    async openTemplate(id){
      if(state.templateDraft.dirty||state.templateBusy)throw Error('Save or discard template edits first.');
      const sequence=++templateSequence;patch({templateBusy:true,templateMessage:''});
      try{const template=await request('/api/native-reporting/workspace/templates/'+id);if(sequence===templateSequence)patch({templateDraft:{id:template.id,name:template.name,sections:copySections(template.sections),dirty:false,confirmed:false,error:''}});}
      catch(error){if(sequence===templateSequence)patch({templateError:error.message});throw error;}
      finally{if(sequence===templateSequence)patch({templateBusy:false});}
    },
    copyReportTemplate(){if(state.templateDraft.dirty||state.templateBusy)throw Error('Save or discard template edits first.');patch({templateDraft:{...newTemplate(),sections:copySections(state.text),dirty:true},templateMessage:''});},
    editTemplate(field,value){const draft=state.templateDraft;if(state.templateBusy)throw Error('Wait for the template action.');if(field!=='name'&&!Object.hasOwn(reportFields,field))throw Error('Unknown template section.');patch({templateDraft:{...draft,...(field==='name'?{name:value}:{sections:{...draft.sections,[field]:value}}),dirty:true,confirmed:false,error:''},templateMessage:''});},
    confirmTemplate(confirmed){patch({templateDraft:{...state.templateDraft,confirmed:Boolean(confirmed)}});},
    async saveTemplate(){
      if(state.templateBusy)return;
      const draft=state.templateDraft;let body;
      try{body=templateInput(draft);}catch(error){patch({templateDraft:{...draft,error:error.message}});throw error;}
      patch({templateBusy:true});
      try{const template=await request('/api/native-reporting/workspace/templates'+(draft.id?'/'+draft.id:''),draft.id?'PUT':'POST',body);patch({templateDraft:{id:template.id,name:template.name,sections:copySections(template.sections),dirty:false,confirmed:false,error:''},templateSelection:'personal:'+template.id,templateMessage:'Template saved. Existing reports are unchanged.'});await store.loadTemplates();}
      catch(error){patch({templateDraft:{...state.templateDraft,error:error.message}});throw error;}
      finally{patch({templateBusy:false});}
    },
    async deleteTemplate(confirmed){
      const draft=state.templateDraft;if(!confirmed||!draft.id||draft.dirty||state.templateBusy)throw Error('Confirm deletion of a saved, unchanged template.');
      patch({templateBusy:true});try{await request('/api/native-reporting/workspace/templates/'+draft.id,'DELETE');store.resetTemplate();patch({templateMessage:'Template deleted. Existing reports are unchanged.'});await store.loadTemplates();}catch(error){patch({templateError:error.message});throw error;}finally{patch({templateBusy:false});}
    },
    editReview(field,value){if(!['reviewComment','preferredReviewer'].includes(field))throw Error('Unknown review field.');patch({[field]:value});},
    async loadReview(){
      if(!state.context?.v2||!state.report)return;
      const active=scope(),sequence=++reviewSequence,url=base();patch({reviewLoading:true});
      try{const [history,reviewers]=await Promise.all([request(url+'/history'),state.report.status==='draft'?request(url+'/reviewers'):Promise.resolve({reviewers:[]})]);if(active===scope()&&sequence===reviewSequence)patch({reviewEvents:history.reviews||[],reviewers:reviewers.reviewers||[]});}
      finally{if(active===scope()&&sequence===reviewSequence)patch({reviewLoading:false});}
    },
    review(action){return busy(async()=>{const preferred=state.preferredReviewer?Number(state.preferredReviewer):null;if(action==='submit'&&preferred!==null&&!state.reviewers.some(r=>Number(r.id)===preferred))throw Error('Select a currently eligible senior reviewer.');const result=await mutate('/review',{action,comment:state.reviewComment,...(action==='submit'?{preferredReviewerId:preferred}:{})});patch({reviewComment:''});await store.loadReview();return result;});},
    async loadAiHealth(){try{const health=await request('/api/medgemma/health');patchAi({health,error:''});}catch(error){patchAi({health:null,error:error.message});throw error;}},
    setAiOption(key,value){if(state.ai.busy||state.ai.proposal)throw Error('Dismiss the current AI proposal first.');if(key==='task'&&!Object.hasOwn(aiTasks,value)||key==='field'&&!Object.hasOwn(reportFields,value)||!['task','field'].includes(key))throw Error('Unknown AI option.');patchAi({[key]:value});},
    async generateAi(){
      if(!editable()||state.conflict||state.busy||state.dictationBusy||state.ai.busy||state.ai.proposal)throw Error('Open an editable report and finish the current action first.');
      const {task,field}=state.ai,original=aiInput(task,field,state.text),context=aiScope(),sequence=++aiSequence;
      clearTimeout(timer);aiController?.abort();const controller=new AbortController();aiController=controller;patchAi({busy:true,error:'',proposal:null});
      try{const result=await request('/api/medgemma/generate','POST',{task,text:original},{},{signal:controller.signal,timeout:630000});if(destroyed||sequence!==aiSequence)return;if(typeof result.text!=='string'||!result.text.trim()||result.text.length>100000)throw Error('AI returned empty or oversized output. The report is unchanged.');patchAi({proposal:{task,field,original,text:result.text,context,applied:false},error:context===aiScope()?'':'The report changed during processing. Dismiss this proposal and run again.'});}
      catch(error){if(sequence===aiSequence&&!controller.signal.aborted)patchAi({error:error.message});}
      finally{if(sequence===aiSequence){patchAi({busy:false});schedule();}}
    },
    aiProposalStale:()=>Boolean(state.ai.proposal&&!state.ai.proposal.applied&&state.ai.proposal.context!==aiScope()),
    acceptAi(){const proposal=state.ai.proposal;if(!proposal||proposal.applied||proposal.task==='review_radiology_report'||store.aiProposalStale()||!editable()||state.busy||state.dictationBusy||state.conflict)throw Error('This AI proposal cannot be applied to the current report.');patch({aiSaveRequired:true});store.edit(proposal.field,proposal.text,{ai:true});patchAi({proposal:{...proposal,applied:true},error:''});},
    undoAi(){const proposal=state.ai.proposal;if(!proposal?.applied||state.text[proposal.field]!==proposal.text||!editable()||state.conflict||state.busy||state.dictationBusy)throw Error('The section changed. Use the preserved original text for manual recovery.');patch({aiSaveRequired:true});store.edit(proposal.field,proposal.original,{ai:true});patchAi({proposal:null,error:''});},
    dismissAi(){cancelAi();schedule();},
    locate: image => locateSource(image.provenance),
    imageUrl: image => base() + '/images/' + image.id,
    printUrl: () => base() + '/print',
    setError: error => patch({error:error.message || String(error)}),
    destroy() { cancelAi();destroyed=true;clearTimeout(timer);requests.forEach(controller=>controller.abort());unsubscribeConnection?.();listeners.clear(); },
    hasUnsaved: () => state.dirty || state.saving || state.busy || state.dictationBusy || aiPending() || state.templateDraft.dirty || state.templateBusy || !!state.pendingCapture || !!state.addendumText || Object.keys(state.captionEdits).length>0,
  };
  const unsubscribeConnection=connection?.subscribe(()=>{
    const status=connection.getSnapshot().status;
    const previous=state.connection;
    patch({connection:status});
    if(status==='denied')patch({context:state.context?{...state.context,canEdit:false,canFinalize:false}:null,report:state.report?{...state.report,canEdit:false,canFinalize:false}:null});
    if(status!=='connected')clearTimeout(timer);
    else if(previous!=='connected') (state.context?store.recover():store.load()).catch(store.setError);
  });
  return store;
}
// crypto.randomUUID is unavailable on an ordinary HTTP LAN. getRandomValues works there.
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
