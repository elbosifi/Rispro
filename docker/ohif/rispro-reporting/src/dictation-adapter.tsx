import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button} from '@ohif/ui-next';
// These are copied verbatim from RISpro by the pinned Docker build. Keep one recorder,
// preference/shortcut implementation, target-safety helper and transcription cleanup.
import {useAudioRecorder} from './dictation-shared/use-audio-recorder';
import {useDictationShortcuts} from './dictation-shared/use-dictation-shortcuts';
import {loadDictationPreferences,DICTATION_PREFERENCES_CHANGED} from './dictation-shared/dictation-preferences';
import {captureDictationTarget} from './dictation-shared/dictation-target';
import {cleanupMedicalDictation} from './dictation-shared/medical-dictation-cleanup';
export default function DictationAdapter({report,enabled,onError}) {
  const [preferences,setPreferences]=useState(loadDictationPreferences),[processing,setProcessing]=useState(false);
  const recorder=useAudioRecorder(preferences.deviceId),target=useRef(null),active=useRef(false),generation=useRef(0),controller=useRef(null),attempted=useRef(null);
  const cancel=()=>{generation.current++;controller.current?.abort();controller.current=null;target.current=null;active.current=false;recorder.cancel();setProcessing(false);};
  const start=()=>{
    if(!enabled||active.current)return;
    const destination=captureDictationTarget(document.activeElement);
    if(!destination?.valid()) {onError(new Error('Focus an editable report field before dictating.'));return;}
    target.current=destination;active.current=true;generation.current++;void recorder.start();
  };
  const stop=()=>{if(active.current)recorder.stop();};
  const toggle=()=>{if(active.current)stop();else start();};
  useDictationShortcuts({enabled,preferences,isActive:()=>active.current||Boolean(captureDictationTarget(document.activeElement)),start,stop,toggle,cancel,isRecording:()=>active.current,isRequesting:()=>recorder.phase==='requesting'});
  useLayoutEffect(()=>{cancel();return cancel;},[report.id,report.status,enabled]);
  useEffect(()=>{const changed=()=>{cancel();setPreferences(loadDictationPreferences());};window.addEventListener(DICTATION_PREFERENCES_CHANGED,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(DICTATION_PREFERENCES_CHANGED,changed);window.removeEventListener('storage',changed);};},[]);
  useEffect(()=>{if(recorder.error){onError(new Error('Microphone: '+recorder.error));cancel();}},[recorder.error]);
  useEffect(()=>{
    const audio=recorder.recording,destination=target.current;
    if(!audio||!destination||recorder.error||attempted.current===audio)return;
    attempted.current=audio;const scope=generation.current,abort=new AbortController();controller.current=abort;setProcessing(true);
    void(async()=>{try{
      if(!enabled||!destination.valid())return;
      const form=new FormData();form.append('file',audio,'dictation.'+(audio.type.includes('mp4')?'m4a':audio.type.includes('ogg')?'ogg':audio.type.includes('wav')?'wav':'webm'));
      const response=await fetch('/api/medical-dictation/transcribe',{method:'POST',credentials:'same-origin',body:form,signal:abort.signal,cache:'no-store'});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message||'Transcription failed.');
      if(scope!==generation.current||!destination.valid())return;
      const text=cleanupMedicalDictation(payload.text||'');if(!text.trim())throw new Error('No speech was detected.');
      active.current=false;if(!destination.insert(text))throw new Error('Report field changed. Transcription was not inserted.');
    }catch(e){if(!abort.signal.aborted&&scope===generation.current)onError(e);}finally{if(scope===generation.current)cancel();}})();
  },[recorder.recording]);
  return <div className="rispro-report-actions" data-dictation-toolbar><Button disabled={!enabled||processing} onMouseDown={e=>e.preventDefault()} onClick={toggle}>{processing?'Transcribing…':recorder.phase==='recording'?'Stop Dictation':'Dictate into Field'}</Button><span role="status">{recorder.phase==='recording'?'Recording':processing?'Processing':'Configured RISpro microphone and shortcuts'}</span></div>;
}
