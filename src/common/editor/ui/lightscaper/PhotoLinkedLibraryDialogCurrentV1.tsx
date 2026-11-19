/* SPDX-License-Identifier: AGPL-3.0-only */
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {PhotoLibraryLinkedWatchCurrentV1 as Watch} from '../../controller/composition/photo-library-linked-watch-current-v1.ts';
import type {PhotoLibraryLinkedCommandsCurrentV1 as Commands} from '../../controller/composition/photo-library-linked-commands-current-v1.ts';
import type {DesktopPhotoLinkedLibraryCurrentV1 as Runtime} from '../../../../lightscaper/desktop-photo-linked-library-current-v1.ts';
import type {DesktopPhotoLinkedGrantCurrentV1 as Grant,DesktopPhotoLinkedScanCurrentV1 as Scan,DesktopPhotoLinkedPageCurrentV1 as Page} from '../../../../lightscaper/desktop-photo-linked-port-current-v1.ts';
import type {DesktopPhotoLinkedOriginalPageCurrentV1 as Originals} from '../../../../lightscaper/desktop-photo-linked-management-contract-current-v1.ts';
import type {PhotoLibraryDevelopPresetReadV3 as Preset} from '../../photo-library-develop-presets-port-v3.ts';
import type {PhotoLibraryImportSettingsV1 as Settings} from '../../photo-library-import-settings-port-v1.ts';
import PhotoImportOptions from './PhotoImportOptions.tsx';
import PhotoImportDevelopPresetsCurrentV1 from './PhotoImportDevelopPresetsCurrentV1.tsx';
import {bundledLightscaperEditorCopyForLocale} from '../../../i18n/lightscaper-editor-copy.ts';
import {photoDevelopSettingsCopy} from '../../../i18n/lightscaper-develop-settings-copy.ts';
import {lightscaperPhotoLinkedCopyCurrentV1 as copyFor} from '../../../i18n/lightscaper-photo-linked-copy-current-v1.ts';
import {message} from './photo-library-workflow-diagnostics.ts';
import {IMAGE_IMPORT_LIMITS} from '../../../imaging/image-import-admission.ts';
type Props=Readonly<{locale:string;commands:Commands;onClose(grantId?:string):void}>;
type Job=Readonly<{stop:AbortController;joined:Promise<void>}>;
const PLAIN:Settings=Object.freeze({rename:null,metadata:Object.freeze({}),keywordIds:Object.freeze([])});
/** The dialog retains only64 pathless scan entries/Original bindings. Its
 * opted-in watch checks that displayed page serially and never queues work. */
export default function PhotoLinkedLibraryDialogCurrentV1({locale,commands,onClose}:Props){
 const copy=copyFor(locale),[grants,setGrants]=useState<readonly Readonly<Grant>[]>([]),[grantCursor,setGrantCursor]=useState<string|null>(null),[grantId,setGrantId]=useState('');
 const [scan,setScan]=useState<Scan|null>(null),[page,setPage]=useState<Readonly<Page>|null>(null),[selected,setSelected]=useState<readonly string[]>([]),[originals,setOriginals]=useState<Readonly<Originals>|null>(null),[originalCursor,setOriginalCursor]=useState<string|null>(null),[targetId,setTargetId]=useState('');
 const [initializing,setInitializing]=useState(true),[busy,setBusy]=useState(false),[closing,setClosing]=useState(false),[failure,setFailure]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[watching,setWatching]=useState(false),[settings,setSettings]=useState<Settings>(PLAIN),[preset,setPreset]=useState<Preset|null>(null),[presetPending,setPresetPending]=useState(false);
 const live=useRef(true),active=useRef<Job|null>(null),scanRef=useRef<Scan|null>(null),closeRef=useRef<Promise<void>|null>(null);
 const watch=useMemo(()=>new Watch(error=>{if(live.current){setWatching(false);setFailure(message(error));}}),[]);const locked=initializing||busy||closing||presetPending||watching;
 const execute=useCallback(<Value,>(action:(runtime:Runtime,signal:AbortSignal,refresh:()=>Promise<void>)=>Promise<Value>,options?:Readonly<{signal?:AbortSignal}>):Promise<Value>=>{
  if(!live.current||active.current)return Promise.reject(new Error('Linked dialog is busy or closed.'));const stop=new AbortController();let finish!:()=>void;const joined=new Promise<void>(resolve=>{finish=resolve;}),job={stop,joined};active.current=job;setBusy(true);setFailure(null);
  let signal=stop.signal,work:Promise<Value>;try{if(options?.signal)signal=AbortSignal.any([signal,options.signal]);work=commands.run(action,{signal});}catch(error){work=Promise.reject(error);}
  return work.catch((error:unknown)=>{if(live.current&&!(signal.aborted&&Object.is(error,signal.reason)))setFailure(message(error));throw error;}).finally(()=>{if(active.current===job)active.current=null;finish();if(live.current)setBusy(false);});
 },[commands]);
 const run=useCallback((action:(runtime:Runtime,signal:AbortSignal,refresh:()=>Promise<void>)=>Promise<void>):Promise<void>=>execute(action).then(()=>undefined,()=>undefined),[execute]);
 const loadOriginals=useCallback(async(runtime:Runtime,signal:AbortSignal,cursor:string|null)=>{const value=await runtime.readOriginalsPage(cursor,{signal});signal.throwIfAborted();if(live.current){setOriginalCursor(cursor);setOriginals(value);setTargetId(current=>value.rows.some(row=>row.photoId===current)?current:'');}},[]);
 useEffect(()=>{const owner={live:true};live.current=true;setInitializing(true);const previous=active.current;
  void(async()=>{if(previous)await previous.joined;if(!owner.live||!live.current)return;await run(async(runtime,signal)=>{const value=await runtime.readGrants(null,{signal});signal.throwIfAborted();if(owner.live&&live.current){setGrants(value.grants);setGrantCursor(value.afterGrantId);}});if(owner.live&&live.current)setInitializing(false);})();
  return()=>{owner.live=false;live.current=false;active.current?.stop.abort(new DOMException('Linked dialog retired.','AbortError'));void watch.stop();void commands.cancelAndJoin();};
 },[commands,run,watch]);
 const open=async(runtime:Runtime,signal:AbortSignal,id:string,entryId?:string):Promise<void>=>{
  const next=await runtime.openScan(id,entryId,{signal});let accepted=false;try{const value=await runtime.nextScan(next,{signal});signal.throwIfAborted();const previous=scanRef.current;if(previous)await runtime.closeScan(previous);scanRef.current=next;accepted=true;if(live.current){setScan(next);setPage(value);setSelected([]);setGrantId(id);}}
  finally{if(!accepted)await runtime.closeScan(next);}
 };
 const cancel=async():Promise<void>=>{active.current?.stop.abort(new DOMException('Linked operation cancelled.','AbortError'));setWatching(false);await Promise.all([watch.stop(),commands.cancelAndJoin()]);await active.current?.joined;};
 const dismiss=(revoking?:string):Promise<void>=>{
  if(closeRef.current)return closeRef.current;setClosing(true);closeRef.current=Promise.resolve().then(async()=>{await cancel();const selectedScan=scanRef.current;if(selectedScan){await commands.run(runtime=>runtime.closeScan(selectedScan));scanRef.current=null;}if(live.current)onClose(revoking);}).catch((error:unknown)=>{closeRef.current=null;if(live.current){setClosing(false);setFailure(message(error));}});return closeRef.current;
 };
 const target=originals?.rows.find(row=>row.photoId===targetId),currentGrant=grants.find(grant=>grant.grantId===grantId);
 const readPresets=useCallback((options?:Readonly<{signal?:AbortSignal}>)=>execute((runtime,signal)=>runtime.listDevelopPresets({signal}),options),[execute]);
 const check=():void=>{void run((runtime,signal)=>loadOriginals(runtime,signal,null));};
 const toggleWatch=(enabled:boolean):void=>{if(enabled){setWatching(true);setFailure(null);watch.start(signal=>commands.run((runtime,owned)=>loadOriginals(runtime,owned,originalCursor),{signal}));}else{setWatching(false);void watch.stop();}};
 return <AudioEditorDialogShell title={copy.photoLinkedTitle} onClose={()=>{void dismiss();}} className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false} initialFocus="[data-photo-linked-choose]">
  <div data-photo-linked-dialog><p>{copy.photoLinkedHelp}</p>
   <button type="button" data-photo-linked-choose disabled={locked} onClick={()=>{void run(async(runtime,signal)=>{const grant=await runtime.chooseFolder({signal});if(!grant)return;const value=await runtime.readGrants(null,{signal});if(live.current){setGrants(value.grants);setGrantCursor(value.afterGrantId);}await open(runtime,signal,grant.grantId);});}}>{copy.photoLinkedChoose}</button>
   <label>{copy.photoLinkedFolders}<select data-photo-linked-grant value={grantId} disabled={locked} onChange={event=>{const id=event.currentTarget.value;setGrantId(id);if(id)void run((runtime,signal)=>open(runtime,signal,id));}}><option value=""/>{grants.map(grant=><option key={grant.grantId} value={grant.grantId} disabled={grant.revoked}>{grant.displayName}</option>)}</select></label>
   <button type="button" disabled={locked||grantCursor===null} onClick={()=>{void run(async(runtime,signal)=>{const value=await runtime.readGrants(grantCursor,{signal});if(live.current){setGrants(value.grants);setGrantCursor(value.afterGrantId);setGrantId('');}});}}>{copy.photoLinkedFolderNext}</button>
   <fieldset disabled={locked}><legend>{copy.photoLinkedFiles}</legend>{page?.entries.map(entry=><div key={entry.entryId}>{entry.kind==='file'?<label><input type="checkbox" data-photo-linked-entry={entry.entryId} checked={selected.includes(entry.entryId)} onChange={event=>{const checked=event.currentTarget.checked;setSelected(previous=>checked?[...previous,entry.entryId]:previous.filter(id=>id!==entry.entryId));}}/>{entry.displayName}</label>:entry.kind==='directory'?<button type="button" data-photo-linked-directory onClick={()=>{void run((runtime,signal)=>open(runtime,signal,grantId,entry.entryId));}}>{entry.displayName}</button>:<span>{entry.displayName}</span>}</div>)}
    <button type="button" disabled={!scan||!page||page.done} onClick={()=>{if(scan)void run(async(runtime,signal)=>{const value=await runtime.nextScan(scan,{signal});if(live.current){setPage(value);setSelected([]);}});}}>{copy.photoLinkedNext}</button>
   </fieldset>
   <PhotoImportOptions value={settings} onChange={setSettings} busy={locked} copy={bundledLightscaperEditorCopyForLocale(locale)}><PhotoImportDevelopPresetsCurrentV1 value={preset} onChange={setPreset} busy={locked} copy={photoDevelopSettingsCopy(locale,'current3')} readPresets={readPresets} onPending={setPresetPending}/></PhotoImportOptions>
   <button type="button" data-photo-linked-import disabled={locked||!scan||selected.length===0} onClick={()=>{if(!scan)return;const chosen={scan,entryIds:Object.freeze([...selected])};void run(async(runtime,signal,refresh)=>{let acknowledged=0;if(live.current)setNotice(null);const onAcknowledged=(item:import('../../photo-library-session-port-v1.ts').PhotoLibraryImportItemV1):void=>{if(item.status==='imported')acknowledged++;if(live.current)setNotice(copy.photoLinkedImported.replace('{count}',String(acknowledged)));};const options={settings,signal,onAcknowledged};const items=preset?await runtime.importEntriesWithDevelop(chosen,{...options,schemaVersion:3,developPreset:preset}):await runtime.importEntries(chosen,options);if(live.current){setNotice(copy.photoLinkedImported.replace('{count}',String(acknowledged)));const failures=items.filter(item=>item.status==='failed').slice(0,IMAGE_IMPORT_LIMITS.maximumFilesPerGesture).map(item=>`${item.fileName.slice(0,256)}: ${(item.message||copy.photoLinkedFailed).slice(0,1024)}`);if(failures.length)setFailure(failures.join('\n'));}await refresh();});}}>{copy.photoLinkedImport}</button>
   <fieldset><legend>{copy.photoLinkedOriginals}</legend><button type="button" data-photo-linked-check disabled={locked} onClick={check}>{copy.photoLinkedCheck}</button><label><input type="checkbox" data-photo-linked-watch checked={watching} disabled={initializing||busy||closing||presetPending||!originals} onChange={event=>toggleWatch(event.currentTarget.checked)}/>{copy.photoLinkedWatch}</label>
    {originals?.rows.map(row=><label key={row.photoId}><input type="radio" name="photo-linked-original" data-photo-linked-original={row.photoId} checked={targetId===row.photoId} disabled={locked} onChange={()=>setTargetId(row.photoId)}/>{row.fileName}: {row.status==='present'?copy.photoLinkedPresent:copy.photoLinkedUnavailable.replace('{reason}',row.reason??'')}</label>)}
    <button type="button" disabled={locked||!originals?.cursor} onClick={()=>{if(originals?.cursor)void run((runtime,signal)=>loadOriginals(runtime,signal,originals.cursor));}}>{copy.photoLinkedNext}</button>
    <p>{copy.photoLinkedRelinkHelp}</p><button type="button" data-photo-linked-relink disabled={locked||!scan||selected.length!==1||!target} onClick={()=>{if(!scan||!target||!selected[0])return;const chosen={scan,entryId:selected[0]};void run(async(runtime,signal)=>{await runtime.relinkEntry(chosen,target.binding,target.locatorRevision,{signal});if(live.current)setNotice(copy.photoLinkedRelinked);await loadOriginals(runtime,signal,originalCursor);});}}>{copy.photoLinkedRelink}</button>
   </fieldset>
   <button type="button" data-photo-linked-revoke disabled={locked||!currentGrant||currentGrant.revoked} onClick={()=>{if(currentGrant&&window.confirm(copy.photoLinkedRevokeConfirm))void dismiss(currentGrant.grantId);}}>{copy.photoLinkedRevoke}</button>
   {(busy||closing)&&<p role="status">{copy.photoLinkedBusy}</p>}{notice&&<p role="status" data-photo-linked-notice>{notice}</p>}{failure&&<p role="alert">{failure||copy.photoLinkedFailed}</p>}
   <button type="button" disabled={!busy&&!watching} onClick={()=>{void cancel();}}>{copy.photoLinkedCancel}</button><button type="button" data-photo-linked-close disabled={closing} onClick={()=>{void dismiss();}}>{copy.photoLinkedClose}</button>
  </div>
 </AudioEditorDialogShell>;
}
