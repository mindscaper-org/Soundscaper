/* SPDX-License-Identifier: AGPL-3.0-only */
import {useContext,useEffect,useRef,useState,useSyncExternalStore,Suspense,lazy} from 'react';
import {createPortal} from 'react-dom';
import {lightscaperMenuEvents} from './lightscaper-menu-events.ts';
import {LightscaperPhotoBackendContextCurrentV1} from './photo-library-backend-context-current-v1.ts';
import {PhotoLinkedCommandsContextCurrentV1} from './photo-linked-commands-context-current-v1.ts';
import {lightscaperPhotoLinkedCopyCurrentV1 as copyFor} from '../../../i18n/lightscaper-photo-linked-copy-current-v1.ts';
const Dialog=lazy(()=>import('./PhotoLinkedLibraryDialogCurrentV1.tsx'));
export default function PhotoLinkedLibraryMenuCurrentV1({locale}:Readonly<{locale:string}>){
 const backend=useContext(LightscaperPhotoBackendContextCurrentV1),commands=useContext(PhotoLinkedCommandsContextCurrentV1);return backend&&commands?<LinkedMenu backend={backend} commands={commands} locale={locale}/>:null;
}
function LinkedMenu({backend,commands,locale}:Readonly<{backend:import('../../controller/composition/lightscaper-photo-backend-switch-current-v1.ts').LightscaperPhotoBackendSwitchCurrentV1;commands:import('../../controller/composition/photo-library-linked-commands-current-v1.ts').PhotoLibraryLinkedCommandsCurrentV1;locale:string}>){
 const state=useSyncExternalStore(backend.subscribe,backend.snapshot,backend.snapshot),[open,setOpen]=useState(false),[revoke,setRevoke]=useState<string|null>(null),returnFocus=useRef<HTMLButtonElement>(null),copy=copyFor(locale);
 const target=state.target instanceof HTMLElement?state.target:null,root=target?.closest('.lightscaper-app')??target?.parentElement;
 useEffect(()=>{if(state.backend!=='native')setOpen(false);},[state.backend]);
 // React has removed the dialog before the destructive transition inspects the
 // actual workspace safety. The same backend owner retires every local child.
 useEffect(()=>{if(open||revoke===null)return;const id=revoke;setRevoke(null);void commands.revoke(id).catch(()=>{window.alert?.(copy.photoLinkedFailed);});},[open,revoke,commands,copy.photoLinkedFailed]);
 if(state.backend!=='native'||!state.nativeAvailable||!target)return null;
 const menu=lightscaperMenuEvents(()=>state.safety==='ready');
 const dismiss=(grantId?:string):void=>{setOpen(false);if(grantId)setRevoke(grantId);else queueMicrotask(()=>{returnFocus.current?.focus();});};
 return <>{createPortal(<button ref={returnFocus} type="button" className="application-header__menu-item" data-photo-linked-menu disabled={!state.ready||state.busy||state.failed||state.safety!=='ready'} onClick={event=>{if(menu.closeMenu(event))setOpen(true);}}>{copy.photoLinkedMenu}</button>,target)}
  {open&&root?createPortal(<Suspense fallback={<div role="dialog" aria-label={copy.photoLinkedTitle}><p role="status">{copy.photoLinkedBusy}</p></div>}><Dialog locale={locale} commands={commands} onClose={dismiss}/></Suspense>,root):null}</>;
}
