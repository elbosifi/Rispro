import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {fetchOhifViewerAvailability} from '@/lib/api-hooks';
import {requestNavigationWithUnsavedGuard} from './unsaved-navigation-guard';

type Launch={status?:string;launchUrl?:string;openMode?:'same_tab'|'new_tab';message?:string};
export function useWorkspaceImages() {
  const availability=useQuery({queryKey:['ohif','availability'],queryFn:fetchOhifViewerAvailability,staleTime:30_000,retry:false});
  const active=useRef(false),alive=useRef(true),tab=useRef<Window|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[blocked,setBlocked]=useState(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;tab.current?.close();};},[]);
  async function launch(request:()=>Promise<Launch>,sameTab=false,beforeLaunch?:()=>Promise<void>) {
    if(active.current)return;
    setError('');setBlocked(false);
    if(!availability.data){setError(availability.error?.message||'Viewer configuration is loading. Try again.');return;}
    const openSame=sameTab||availability.data.openMode==='same_tab';
    // This runs in the click stack, before saving or requesting a launch token.
    const placeholder=openSame?null:window.open('about:blank','_blank');
    if(!openSame&&!placeholder){setBlocked(true);setError('The browser blocked the OHIF tab. Allow popups for RISpro, or open images in this tab.');return;}
    if(placeholder)placeholder.opener=null;
    tab.current=placeholder;active.current=true;setBusy(true);
    try {
      await beforeLaunch?.();
      if(!alive.current)return;
      const result=await request();
      if(!alive.current)return;
      if(result.status!=='ready'||!result.launchUrl)throw new Error(result.message||'Images are unavailable.');
      // Launch URLs remain local, short lived and absent from rendered errors/state.
      if(!result.launchUrl.startsWith('/api/ohif/launch/'))throw new Error('Invalid viewer launch URL.');
      if(sameTab||result.openMode==='same_tab') {
        placeholder?.close();
        requestNavigationWithUnsavedGuard(()=>window.location.assign(result.launchUrl!));
      } else {
        if(!placeholder||placeholder.closed)throw new Error('The OHIF tab was closed. Try View Images again.');
        placeholder.location.replace(result.launchUrl);
      }
    } catch(e) {placeholder?.close();if(alive.current)setError((e as Error).message);}
    finally {tab.current=null;active.current=false;if(alive.current)setBusy(false);}
  }
  return {launch,busy,error:error||availability.error?.message||'',blocked,ready:Boolean(availability.data)};
}
