/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React,{act}from'react';
import{renderToStaticMarkup}from'react-dom/server';
import NyquistDialog from'../src/common/editor/ui/dialogs/NyquistDialog.jsx';
import NyquistGetEffectsDialog from'../src/common/editor/ui/dialogs/NyquistGetEffectsDialog.jsx';
import{ENGLISH_COPY}from'../src/common/i18n/catalogs.js';
import{installReactTestDom}from'./helpers/react-test-dom.ts';
Object.assign(globalThis,{React,IS_REACT_ACT_ENVIRONMENT:true});
test('bundled Nyquist controls localize by stable identity and retain plugin names',()=>{
	const copy={...ENGLISH_COPY,'ui.nyquistBundled.rhythmtrack.control.TIMESIG.label':'Schläge pro Takt','ui.nyquistBundled.rhythmtrack.control.OFFSET.unit':'Stille vor dem ersten Schlag','ui.nyquistBundled.rhythmtrack.control.CLICK-TYPE.option.0':'Metronomtick','ui.nyquistBundled.rhythmtrack.control.note-3.label':'Null Takte aktivieren die Dauer.'};
	const html=renderToStaticMarkup(<NyquistDialog controller={{actions:{nyquist:{cancel(){}}}}} snapshot={{readOnly:false}} copy={copy} target={{pluginId:'nyquist:rhythmtrack'}} run={(operation:()=>unknown)=>operation()} onClose={()=>undefined}/>);
	for(const text of ['Schläge pro Takt','Stille vor dem ersten Schlag','Metronomtick','Null Takte aktivieren die Dauer.','Rhythm Track'])assert.ok(html.includes(text),text);
});
test('the real catalog dialog presents a localized HTTP download failure',async()=>{
	const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:404});
	const dom=installReactTestDom();const{createRoot}=await import('react-dom/client');const root=createRoot(dom.container as unknown as Element);
	try{await act(async()=>root.render(<NyquistGetEffectsDialog copy={{...ENGLISH_COPY,'ui.nyquistArchive.downloadHttp':'Download fehlgeschlagen (HTTP {status}).'}} onClose={()=>undefined}/>));await act(async()=>{await new Promise<void>(resolve=>setImmediate(resolve));});assert.equal(dom.one('[role="alert"]').textContent,'Download fehlgeschlagen (HTTP 404).');}finally{await act(async()=>root.unmount());dom.restore();globalThis.fetch=original;}
});

test('archive storage errors preserve their diagnostic and localize the actual failure family',async()=>{
	const{createNyquistArchiveStore,NYQUIST_ARCHIVE_ID}=await import('../src/common/editor/nyquist/archive-store.js');
	const{nyquistArchiveErrorLabel}=await import('../src/common/editor/ui/dialogs/nyquist-archive-error-copy.ts');
	const{resolveNyquistArchiveCopy}=await import('../src/common/i18n/editor-nyquist-archive-copy.ts');
	const original=new DOMException('English disk quota diagnostic','QuotaExceededError');
	const store=createNyquistArchiveStore({getItem:()=>null,setItem(){throw original;}});
	let failure:unknown;
	try{store.install({id:'nyquist:archive:Mine.ny',fileName:'Mine.ny',archiveId:NYQUIST_ARCHIVE_ID,source:'$nyquist plug-in\n$version 4\n$type process\n$name "Mine"\n(mult *track* 0.5)\n'});}catch(error){failure=error;}
	assert.equal(failure,original);assert.equal(nyquistArchiveErrorLabel(failure,'install',resolveNyquistArchiveCopy({'ui.nyquistArchive.storageQuota':'Der Browserspeicher ist voll.'})),'Der Browserspeicher ist voll.');
});

test('installed plug-in prose and stable parameter values remain authored data',async()=>{
	const{createNyquistArchiveStore,NYQUIST_ARCHIVE_ID}=await import('../src/common/editor/nyquist/archive-store.js');
	const{localizeBundledNyquistControl}=await import('../src/common/editor/ui/dialogs/nyquist-bundled-control-copy.ts');
	const store=createNyquistArchiveStore({getItem:()=>null,setItem(){}});
	const plugin=store.install({id:'nyquist:archive:Mine.ny',fileName:'Mine.ny',archiveId:NYQUIST_ARCHIVE_ID,source:'$nyquist plug-in\n$version 4\n$type process\n$name "Mine"\n$control amount "Authored $& amount" real "" 0.5 0 1\n(mult *track* amount)\n'});
	const control=plugin.controls[0];assert.ok(control);
	const localized=localizeBundledNyquistControl(plugin.id,control,0,{'archive:Mine.ny.control.amount.label':'Wrong translation'});
	assert.equal(localized.label,'Authored $& amount');assert.equal(localized.variable,'amount');assert.equal(localized.defaultValue,0.5);
});
