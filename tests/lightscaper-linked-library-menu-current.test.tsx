/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import React,{act} from 'react';
import {LightscaperPhotoBackendSwitchCurrentV1 as Switch} from '../src/common/editor/controller/composition/lightscaper-photo-backend-switch-current-v1.ts';
import {LightscaperPhotoBackendContextCurrentV1 as BackendContext} from '../src/common/editor/ui/lightscaper/photo-library-backend-context-current-v1.ts';
import {PhotoLinkedCommandsContextCurrentV1 as CommandsContext} from '../src/common/editor/ui/lightscaper/photo-linked-commands-context-current-v1.ts';
import {PhotoLibraryLinkedCommandsCurrentV1 as Commands} from '../src/common/editor/controller/composition/photo-library-linked-commands-current-v1.ts';
import Menu from '../src/common/editor/ui/lightscaper/PhotoLinkedLibraryMenuCurrentV1.tsx';
import Restore from '../src/common/editor/ui/lightscaper/PhotoCatalogRestoreDialog.tsx';
import {lightscaperRestoreCopy} from '../src/common/i18n/lightscaper-restore-copy.ts';
import {mountPhotoImportUi} from './helpers/photo-import-options-react-fixture.tsx';
import {reactProps} from './helpers/react-test-dom.ts';
import {settle} from './helpers/async-test-control.ts';
void test('Import-in-place remains absent in default Web and appears only inside the registered native File menu',async()=>{
 await import('../src/common/editor/ui/lightscaper/PhotoLinkedLibraryDialogCurrentV1.tsx');
 const backend=new Switch({nativeAvailable:true}),commands=new Commands({resolveSession:async()=>null,revoke:async()=>{}});const mounted=await mountPhotoImportUi(()=> <BackendContext.Provider value={backend}><CommandsContext.Provider value={commands}><section className="lightscaper-app"><nav><div data-file-target/><div data-view-target/></nav><Menu locale="en"/></section></CommandsContext.Provider></BackendContext.Provider>);let off:()=>void=()=>undefined;
 try{const target=mounted.dom.one('[data-file-target]'),view=mounted.dom.one('[data-view-target]');await act(async()=>{off=backend.register({target,safety:()=> 'ready',fence(){},async retireAndJoin(){}});await settle();});assert.equal(mounted.dom.find('[data-photo-linked-menu]'),null);
  await act(async()=>{await backend.select('native');off();off=backend.register({target,safety:()=> 'ready',fence(){},async retireAndJoin(){}});await settle();});const menu=mounted.dom.one('[data-photo-linked-menu]');assert.ok(target.contains(menu));assert.equal(view.contains(menu),false);assert.equal(menu.tagName.toLowerCase(),'button');assert.equal(mounted.dom.find('[data-photo-linked-dialog]'),null);
  await act(async()=>{reactProps(menu).onClick?.({currentTarget:menu});await settle();});assert.ok(mounted.dom.find('[data-photo-linked-dialog]'));
 }finally{await act(async()=>{off();await commands.cancelAndJoin();await backend.close();});await mounted.dispose();}
});
for(const native of [false,true])void test(`Restore confirmation states managed-copy conversion only for explicit native backend (${native})`,async()=>{
 const backend=new Switch({nativeAvailable:true});let off=backend.register({target:null,safety:()=> 'ready',fence(){},async retireAndJoin(){}});if(native){await backend.select('native');off();off=()=>undefined;}
 const mounted=await mountPhotoImportUi(()=> <BackendContext.Provider value={backend}><Restore locale="en" copy={lightscaperRestoreCopy('en')} ready busy={false} cancelling={false} cancelled={false} receipt={null} error={null} onRestore={async()=>null} onCancel={async()=>{}} onClose={()=>{}}/></BackendContext.Provider>);
 try{assert.equal(mounted.dom.find('[data-photo-linked-restore-policy]')!==null,native);}finally{await act(async()=>{off();await backend.close();});await mounted.dispose();}
});
