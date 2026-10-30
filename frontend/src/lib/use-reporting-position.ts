import {useLayoutEffect,useRef} from 'react';

const positions=new Map<string,{top:number;windowTop:number;left:number}>();
export function useReportingPosition(key:string,ready:boolean) {
  const root=useRef<HTMLDivElement>(null),table=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(!ready)return;
    const main=root.current?.closest('main'),saved=positions.get(key);
    if(saved){if(main)main.scrollTop=saved.top;window.scrollTo(0,saved.windowTop);if(table.current)table.current.scrollLeft=saved.left;}
    else {if(main)main.scrollTop=0;window.scrollTo(0,0);}
    const remember=()=>{
      positions.set(key,{top:main?.scrollTop||0,windowTop:window.scrollY,left:table.current?.scrollLeft||0});
      if(positions.size>50)positions.delete(positions.keys().next().value!);
    };
    main?.addEventListener('scroll',remember);window.addEventListener('scroll',remember);const container=table.current;container?.addEventListener('scroll',remember);
    return()=>{main?.removeEventListener('scroll',remember);window.removeEventListener('scroll',remember);container?.removeEventListener('scroll',remember);};
  },[key,ready]);
  return {root,table};
}
