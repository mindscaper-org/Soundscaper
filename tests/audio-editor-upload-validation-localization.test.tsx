/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React,{act}from'react';
import AudiocomUploadArea from '../src/common/editor/ui/workspace/AudiocomUploadArea.tsx';
import FreesoundUploadArea from '../src/common/editor/ui/workspace/FreesoundUploadArea.tsx';
import FreesoundPublishDialog from '../src/common/editor/ui/workspace/FreesoundPublishDialog.tsx';
import {createAudiocomUploadQueue}from'../src/common/editor/controller/import/internal/audiocom-upload-queue.ts';
import type {AudiocomApiClient}from'../src/common/editor/controller/import/audiocom-panel-session.ts';
import {createFreesoundUploadQueue,type FreesoundUploadItem}from'../src/common/editor/ui/workspace/freesound-upload-queue.ts';
import {validateFreesoundUploadMetadata}from'../src/common/editor/freesound-upload-metadata.ts';
import {AUDIOCOM_COPY_BY_LOCALE}from'../src/common/i18n/audiocom-copy.ts';
import{FREESOUND_ATTRIBUTION_ENGLISH_COPY}from'../src/common/i18n/freesound-attribution-copy.js';
import{installReactTestDom,reactProps}from'./helpers/react-test-dom.ts';
Object.assign(globalThis,{React,IS_REACT_ACT_ENVIRONMENT:true});
for(const provider of ['audiocom','freesound']as const)for(const empty of [false,true])test(`${provider} ${empty?'empty audio':'unsupported file'} uses localized validation from the actual queue`,async()=>{
	const dom=installReactTestDom();const{createRoot}=await import('react-dom/client');const root=createRoot(dom.container as unknown as Element);
	const file=new File(empty?[]:['image'],empty?'$& silence.wav':'$& photo.png',{type:empty?'audio/wav':'image/png'});
	const messages={uploadValidationEmptyFile:'{fileName} ist leer.',uploadValidationUnsupportedFile:'{fileName} hat ein ungültiges Dateiformat.'};
	const audiocom=createAudiocomUploadQueue({}as AudiocomApiClient,()=>true,()=>undefined,()=>undefined);
	const freesound=createFreesoundUploadQueue({upload:async()=>({uploadFilename:'unused'}),describe:async()=>({soundId:1,status:'pending_moderation'})});
	try{await act(async()=>root.render(provider==='audiocom'?<AudiocomUploadArea copy={{...AUDIOCOM_COPY_BY_LOCALE.en,...messages}} disabled={false} queue={audiocom.snapshot()} onFiles={files=>{audiocom.enqueueFiles(files);}} onPublish={()=>undefined} onRetry={()=>undefined} onCancel={()=>undefined} onRemove={()=>undefined}/>:<FreesoundUploadArea copy={{...FREESOUND_ATTRIBUTION_ENGLISH_COPY,...messages}} queue={freesound.getSnapshot()} onFiles={files=>{freesound.enqueueFiles(files);}}/>));
		const input=dom.container.querySelectorAll('input').find(node=>node.type==='file');assert.ok(input);
		await act(async()=>reactProps(input).onChange?.({currentTarget:{files:[file],value:'chosen'}}));
		assert.equal(dom.one('[role="alert"]').textContent,empty?'$& silence.wav ist leer.':'$& photo.png hat ein ungültiges Dateiformat.');
	}finally{audiocom.dispose();freesound.clear();await act(async()=>root.unmount());dom.restore();}
});
test('the publishing form localizes actual tag validation instead of raw parser prose',async()=>{
	const dom=installReactTestDom();const{createRoot}=await import('react-dom/client');const root=createRoot(dom.container as unknown as Element);
	const item:FreesoundUploadItem={id:'upload',sourceKind:'file',fileName:'Voice.wav',byteLength:1,status:'ready-to-publish',uploadFilename:'remote.wav',title:'Voice',description:'Field recording',tags:['one','two'],categoryId:'fx-other',license:'cc-by',rightsConfirmed:true};
	try{await act(async()=>root.render(<FreesoundPublishDialog copy={{...FREESOUND_ATTRIBUTION_ENGLISH_COPY,uploadValidationTagsTooFew:'Mindestens {minimum} Tags sind erforderlich.'}} item={item} onClose={()=>undefined} onPublish={(_id,draft)=>Promise.resolve().then(()=>{validateFreesoundUploadMetadata(draft);})}/>));await act(async()=>reactProps(dom.one('form')).onSubmit?.({preventDefault(){}}));assert.equal(dom.one('[role="alert"]').textContent,'Mindestens 3 Tags sind erforderlich.');}finally{await act(async()=>root.unmount());dom.restore();}
});

test('queued transfer failures retain diagnostics while the row presents the localized family',async()=>{
	const queue=createFreesoundUploadQueue({upload:async()=>{throw new Error('English transport diagnostic');},describe:async()=>({soundId:1,status:'pending_moderation'})});
	try{queue.enqueueFiles([new File(['wave'],'Voice.wav',{type:'audio/wav'})]);await new Promise<void>(resolve=>setImmediate(resolve));const item=queue.getSnapshot().items[0];assert.equal(item?.errorMessage,'English transport diagnostic');const{renderToStaticMarkup}=await import('react-dom/server');const html=renderToStaticMarkup(<FreesoundUploadArea copy={{...FREESOUND_ATTRIBUTION_ENGLISH_COPY,uploadValidationTransferFailed:'Die Audioübertragung ist fehlgeschlagen.'}} queue={queue.getSnapshot()}/>);assert.ok(html.includes('Die Audioübertragung ist fehlgeschlagen.'));assert.ok(!html.includes('English transport diagnostic'));}finally{queue.clear();}
});

test('retained upload validation follows a language change without revalidating the file',async()=>{
	const dom=installReactTestDom();const{createRoot}=await import('react-dom/client');const root=createRoot(dom.container as unknown as Element);let attempts=0;
	const queue=createAudiocomUploadQueue({}as AudiocomApiClient,()=>true,()=>undefined,()=>undefined);
	const render=(message:string)=><AudiocomUploadArea copy={{...AUDIOCOM_COPY_BY_LOCALE.en,uploadValidationUnsupportedFile:message}} disabled={false} queue={queue.snapshot()} onFiles={files=>{attempts++;queue.enqueueFiles(files);}} onPublish={()=>undefined} onRetry={()=>undefined} onCancel={()=>undefined} onRemove={()=>undefined}/>;
	try{await act(async()=>root.render(render('Ungültiges Format: {fileName}')));const input=dom.container.querySelectorAll('input').find(node=>node.type==='file');assert.ok(input);await act(async()=>reactProps(input).onChange?.({currentTarget:{files:[new File(['image'],'$& photo.png',{type:'image/png'})],value:'chosen'}}));await act(async()=>root.render(render('Format invalide : {fileName}')));assert.equal(dom.one('[role="alert"]').textContent,'Format invalide : $& photo.png');assert.equal(attempts,1);}finally{queue.dispose();await act(async()=>root.unmount());dom.restore();}
});
