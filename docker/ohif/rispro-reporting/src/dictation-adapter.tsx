import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button} from '@ohif/ui-next';
// Copied verbatim from RISpro by the pinned Docker build: one recorder and preference store.
import {useAudioRecorder} from './dictation-shared/use-audio-recorder';
import {useDictationShortcuts} from './dictation-shared/use-dictation-shortcuts';
import {loadDictationPreferences,saveDictationPreferences,formatShortcut,DICTATION_PREFERENCES_CHANGED,DICTATION_PREFERENCES_KEY} from './dictation-shared/dictation-preferences';
import {captureDictationTarget} from './dictation-shared/dictation-target';
import {cleanupMedicalDictation} from './dictation-shared/medical-dictation-cleanup';

export default function DictationAdapter({report,contextKey,enabled,onError,onBusyChange=undefined}) {
  const [preferences,setPreferences]=useState(loadDictationPreferences),[processing,setProcessing]=useState(false);
  const [targetLabel,setTargetLabel]=useState('None — select a report field'),[devices,setDevices]=useState([]),[deviceNotice,setDeviceNotice]=useState('');
  const recorder=useAudioRecorder(preferences.deviceId),toolbar=useRef(null),remembered=useRef(null),target=useRef(null);
  const active=useRef(false),testing=useRef(false),generation=useRef(0),controller=useRef(null),attempted=useRef(null);
  const cancel=()=>{generation.current++;controller.current?.abort();controller.current=null;target.current=null;active.current=false;testing.current=false;recorder.cancel();setProcessing(false);};
  const clearTarget=()=>{remembered.current=null;setTargetLabel('None — select a report field');};
  const start=()=>{
    if(!enabled||active.current||testing.current)return;
    const destination=remembered.current;
    if(!destination?.valid()) {clearTarget();onError(new Error('Select an editable report field before dictating.'));return;}
    target.current=destination;active.current=true;generation.current++;void recorder.start();
  };
  const stop=()=>{if(active.current){if(recorder.phase==='requesting')cancel();else recorder.stop();}};
  const toggle=()=>{if(active.current)stop();else start();};
  useDictationShortcuts({enabled:enabled&&!testing.current,preferences,isActive:()=>active.current||Boolean(remembered.current?.valid()),start,stop,toggle,cancel,isRecording:()=>active.current,isRequesting:()=>recorder.phase==='requesting'});
  useLayoutEffect(()=>{cancel();clearTarget();return cancel;},[contextKey,report.id,report.status,enabled]);
  useEffect(()=>{
    const root=toolbar.current?.closest('.rispro-report');
    if(!enabled||!root)return;
    const eligible=element=>element instanceof HTMLTextAreaElement&&root.contains(element)&&element.matches('textarea[data-report-field]');
    const remember=event=>{
      const element=event.type==='selectionchange'?document.activeElement:event.target;
      // Viewport/toolbar interaction never changes the destination.
      if(!eligible(element)||element.dataset.dictationInserting)return;
      const next=captureDictationTarget(element);
      if(active.current){
        if(element!==target.current?.element||!target.current?.valid())cancel();
        else return; // Freeze the selection for the in-flight transcription.
      }
      remembered.current=next;setTargetLabel(next?element.getAttribute('aria-label'):'None — select a report field');
    };
    const validate=()=>{if(remembered.current&&!remembered.current.valid()){cancel();clearTarget();}};
    const events=['focusin','focusout','select','input','keyup','pointerup'];
    events.forEach(name=>root.addEventListener(name,remember,true));document.addEventListener('selectionchange',remember);
    const observer=new MutationObserver(validate);observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['readonly','disabled','hidden','inert','aria-hidden','aria-disabled','data-dictation-context']});
    return()=>{events.forEach(name=>root.removeEventListener(name,remember,true));document.removeEventListener('selectionchange',remember);observer.disconnect();};
  },[enabled,contextKey]);
  useEffect(()=>{
    const changed=event=>{if(event.type==='storage'&&event.key&&event.key!==DICTATION_PREFERENCES_KEY)return;cancel();setPreferences(loadDictationPreferences());};
    window.addEventListener(DICTATION_PREFERENCES_CHANGED,changed);window.addEventListener('storage',changed);
    return()=>{window.removeEventListener(DICTATION_PREFERENCES_CHANGED,changed);window.removeEventListener('storage',changed);};
  },[]);
  const refreshDevices=async()=>{
    try{if(!navigator.mediaDevices?.enumerateDevices)throw new Error('Microphone selection is unavailable in this browser.');
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'&&d.deviceId&&d.deviceId!=='default'));setDeviceNotice('');
    }catch(e){setDeviceNotice(e.message);}
  };
  useEffect(()=>{void refreshDevices();navigator.mediaDevices?.addEventListener?.('devicechange',refreshDevices);return()=>navigator.mediaDevices?.removeEventListener?.('devicechange',refreshDevices);},[]);
  useEffect(()=>{if(recorder.phase==='recording')void refreshDevices();},[recorder.phase]);
  useEffect(()=>{if(recorder.error){onError(new Error('Microphone: '+recorder.error));cancel();}},[recorder.error]);
  useEffect(()=>{
    const audio=recorder.recording,destination=target.current;
    // Microphone tests use the same recorder and never call MedASR or insert text.
    if(testing.current||!audio||!destination||recorder.error||attempted.current===audio)return;
    attempted.current=audio;const scope=generation.current,abort=new AbortController();controller.current=abort;setProcessing(true);
    void(async()=>{try{
      if(!enabled||!destination.valid())return;
      const form=new FormData();form.append('file',audio,'dictation.'+(audio.type.includes('mp4')?'m4a':audio.type.includes('ogg')?'ogg':audio.type.includes('wav')?'wav':'webm'));
      const response=await fetch('/api/medical-dictation/transcribe',{method:'POST',credentials:'same-origin',body:form,signal:abort.signal,cache:'no-store'});
      const payload=await response.json();if(!response.ok)throw new Error('Transcription failed. Check RISpro dictation settings and retry.');
      if(scope!==generation.current||!enabled||!destination.valid())return;
      const text=cleanupMedicalDictation(payload.text||'');if(!text.trim())throw new Error('No speech was detected.');
      destination.element.dataset.dictationInserting='true';
      try{if(!destination.insert(text))throw new Error('Report field changed. Transcription was not inserted.');}
      finally{delete destination.element.dataset.dictationInserting;}
      remembered.current=captureDictationTarget(destination.element);setTargetLabel(destination.element.getAttribute('aria-label'));
    }catch(e){if(!abort.signal.aborted&&scope===generation.current)onError(e);}finally{if(scope===generation.current)cancel();}})();
  },[recorder.recording]);
  const savePreferences=next=>{try{saveDictationPreferences(next);}catch{onError(new Error('Microphone preferences could not be saved in this browser.'));}};
  const status=processing?'Transcribing':recorder.phase==='recording'?`${testing.current?'Testing microphone':'Recording'} (${recorder.duration} / 60 s)`:recorder.phase==='requesting'?'Allow microphone access':recorder.phase==='stopping'?'Stopping':'Ready';
  const occupied=active.current||processing||recorder.phase!=='idle';
  useEffect(()=>{onBusyChange?.(occupied);return()=>onBusyChange?.(false);},[occupied,onBusyChange]);
  return <div ref={toolbar} className="rispro-report-dictation" data-dictation-toolbar>
    <div className="rispro-report-actions"><Button disabled={!enabled||processing||testing.current} onMouseDown={e=>e.preventDefault()} onClick={toggle}>{processing?'Transcribing…':recorder.phase==='recording'&&!testing.current?'Stop Dictation':'Dictate into Field'}</Button>
      {(active.current||testing.current)&&<Button variant="outline" onClick={cancel}>Cancel recording</Button>}
    </div>
    <span className="rispro-report-target">Target: {targetLabel}</span><span role="status">{status}</span>
    <details data-dictation-controls><summary>Microphone / shortcuts</summary>
      <label>Selected microphone<select aria-label="Selected microphone" value={preferences.deviceId} disabled={occupied} onChange={e=>savePreferences({...preferences,deviceId:e.target.value})}>
        <option value="">Workstation default microphone</option>{preferences.deviceId&&!devices.some(d=>d.deviceId===preferences.deviceId)&&<option value={preferences.deviceId}>Saved microphone (unavailable / refresh)</option>}
        {devices.map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||`Microphone ${i+1}`}</option>)}
      </select></label>
      <div className="rispro-report-actions"><Button variant="outline" onClick={refreshDevices}>Refresh microphones</Button><Button disabled={occupied} onClick={()=>{cancel();testing.current=true;void recorder.start();}}>Test microphone</Button><Button variant="outline" disabled={!testing.current||recorder.phase==='idle'} onClick={recorder.stop}>Stop test</Button><Button variant="outline" disabled={!testing.current} onClick={cancel}>End test</Button></div>
      <label>Input level<meter aria-label="Microphone input level" min={0} max={1} value={recorder.level}/></label>
      <p>Test audio stays in this browser. Recording stops after 60 seconds.</p>{recorder.notice&&<p role="status">{recorder.notice}</p>}{deviceNotice&&<p role="status">{deviceNotice}</p>}
      <label>Keyboard dictation<select aria-label="Keyboard dictation" value={preferences.keyboardEnabled?'on':'off'} disabled={occupied} onChange={e=>savePreferences({...preferences,keyboardEnabled:e.target.value==='on'})}><option value="on">{formatShortcut(preferences.keyboardShortcut)} enabled</option><option value="off">Disabled</option></select></label>
      <label>Keyboard mode<select aria-label="Keyboard dictation mode" value={preferences.keyboardMode} disabled={occupied} onChange={e=>savePreferences({...preferences,keyboardMode:e.target.value})}><option value="hold">Hold to talk</option><option value="toggle">Toggle recording</option></select></label>
      <p>SpeechMike / Dragon: {preferences.speechMikeEnabled?preferences.speechMikeMode==='separate'?`${formatShortcut(preferences.speechMikeStart)} start / ${formatShortcut(preferences.speechMikeStop)} stop`:`${formatShortcut(preferences.speechMikeShortcut)} (${preferences.speechMikeMode})`:'Disabled'}</p>
      <a href="/doctor/dictation-controls" target="_blank" rel="noopener noreferrer">Configure dictation shortcuts and SpeechMike</a>
    </details>
  </div>;
}
