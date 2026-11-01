import React from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import DictationAdapter from './src/dictation-adapter';
import {loadDictationPreferences} from '../../../frontend/src/lib/dictation-preferences';
const audio=vi.hoisted(()=>({phase:'idle',recording:null,error:null,level:0,duration:0,meterAvailable:true,notice:'',start:vi.fn(),stop:vi.fn(),cancel:vi.fn()}));
vi.mock('../../../frontend/src/hooks/use-audio-recorder',()=>({useAudioRecorder:()=>audio}));
const onError=vi.fn();let fetcher;
beforeEach(()=>{
  vi.useFakeTimers();vi.spyOn(document,'hasFocus').mockReturnValue(true);localStorage.clear();
  Object.assign(audio,{phase:'idle',recording:null,error:null});audio.start.mockClear();audio.stop.mockClear();audio.cancel.mockClear();onError.mockClear();
  fetcher=vi.fn(async()=>({ok:true,json:async()=>({text:'dictated finding'})}));vi.stubGlobal('fetch',fetcher);
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{enumerateDevices:async()=>[{deviceId:'mic-1',kind:'audioinput',label:'Test microphone'}]}});
  document.execCommand=vi.fn((_,__,text)=>{const el=document.activeElement as HTMLTextAreaElement;el.setRangeText(text,el.selectionStart,el.selectionEnd,'end');fireEvent.input(el);return true;});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(props={}) {
  const options={report:{id:1,status:'draft'},contextKey:'patient:1/study:1/report:1',enabled:true,onError,...props};
  const component=next=><><button aria-label="Image viewport">Image</button><section className="rispro-report" data-dictation-context={next.contextKey}>
    <DictationAdapter {...next}/>{['Findings','Impression','Technique','Comparison','Clinical history'].map(label=><textarea key={label} aria-label={label} data-report-field={label} defaultValue="Before after" readOnly={!next.enabled}/>)}</section></>;
  const view=render(component(options));
  return {...view,options,update(next={}){Object.assign(options,next);view.rerender(component(options));}};
}
function select(label='Findings',from=7,to=7){const field=screen.getByLabelText(label) as HTMLTextAreaElement;act(()=>{field.focus();field.setSelectionRange(from,to);fireEvent.select(field);});return field;}
async function hold(){fireEvent.keyDown(window,{code:'ShiftRight',key:'Shift',shiftKey:true});await act(async()=>{vi.advanceTimersByTime(220);});}
async function transcribe(view){fireEvent.keyUp(window,{code:'ShiftRight',key:'Shift'});audio.recording=new Blob(['audio'],{type:'audio/webm'});await act(async()=>{view.update();});}
it.each(['focused','viewport click','slice scroll','zoom/pan/window level'])('Right Shift retains Findings selection after %s without focusing it to record',async action=>{
  const view=mount(),field=select();
  if(action!=='focused'){screen.getByRole('button',{name:'Image viewport'}).focus();fireEvent.pointerDown(screen.getByRole('button',{name:'Image viewport'}));fireEvent.wheel(window,{deltaY:100});fireEvent.pointerMove(window,{buttons:1});}
  const focused=document.activeElement;await hold();expect(audio.start).toHaveBeenCalledTimes(1);expect(document.activeElement).toBe(focused);
  expect(screen.getByText('Target: Findings')).toBeTruthy();await transcribe(view);expect(field.value).toBe('Before Dictated finding after');expect(document.activeElement).toBe(focused);
});
it.each(['Impression','Technique','Comparison','Clinical history'])('remembers the selection in %s',async label=>{
  const view=mount(),field=select(label);act(()=>screen.getByRole('button',{name:'Image viewport'}).focus());await hold();await transcribe(view);expect(field.value).toBe('Before Dictated finding after');
});
it.each(['report','patient','readonly'])('invalidates a pending transcription when switching %s',async change=>{
  let resolve;fetcher.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const view=mount(),field=select();await hold();await transcribe(view);
  await act(async()=>view.update(change==='report'?{report:{id:2,status:'draft'},contextKey:'patient:1/report:2'}:change==='patient'?{contextKey:'patient:2/report:1'}:{enabled:false,report:{id:1,status:'final'}}));
  await act(async()=>resolve({ok:true,json:async()=>({text:'stale patient text'})}));
  expect(field.value).toBe('Before after');expect(screen.getByText(/Target: None/)).toBeTruthy();
});
it('rejects edited or removed targets and preserves selected-text replacement safety',async()=>{
  const view=mount(),field=select('Findings',0,6);let resolve;fetcher.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  await hold();await transcribe(view);field.value='manual edit';fireEvent.input(field);
  await act(async()=>resolve({ok:true,json:async()=>({text:'late text'})}));expect(field.value).toBe('manual edit');
  select();field.remove();await act(async()=>{});await hold();expect(audio.start).toHaveBeenCalledTimes(1);
});
it('microphone selection uses the existing preferences; a test never transcribes',async()=>{
  const view=mount();await act(async()=>{});
  fireEvent.change(screen.getByLabelText('Selected microphone'),{target:{value:'mic-1'}});expect(loadDictationPreferences().deviceId).toBe('mic-1');
  fireEvent.click(screen.getByRole('button',{name:'Test microphone'}));expect(audio.start).toHaveBeenCalledTimes(1);
  audio.recording=new Blob(['test']);await act(async()=>view.update());expect(fetcher).not.toHaveBeenCalled();
});
it('releasing Right Shift during microphone permission cancels and permits a new hold',async()=>{
  const view=mount();select();await hold();audio.phase='requesting';await act(async()=>view.update());
  fireEvent.keyUp(window,{code:'ShiftRight',key:'Shift'});expect(audio.cancel).toHaveBeenCalled();
  audio.phase='idle';await act(async()=>view.update());await hold();expect(audio.start).toHaveBeenCalledTimes(2);
});
