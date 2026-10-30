/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import{renderToStaticMarkup}from'react-dom/server';
import{ENGLISH_COPY}from'../src/common/i18n/catalogs.js';
import WorkspacePanelContent from'../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import RecordingSetupPanel from'../src/common/editor/ui/workspace/RecordingSetupPanel.tsx';
import{captureSessionFailure}from'../src/common/editor/controller/capture/internal/framescaper-capture-session-runtime.ts';
import type{FramescaperCaptureUiSnapshot}from'../src/common/editor/ui/framescaper-capture-ui-model.ts';
import{createSoundscaperProject}from'../src/soundscaper/editor-project.ts';
import{createDocumentMasteringSequenceSnapshot}from'../src/common/editor/controller/document/document-mastering-sequence-snapshot.ts';
import Editor from'../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceEditor.tsx';
import{SOUNDSCAPER_MASTERING_SEQUENCE_COPY}from'../src/common/editor/ui/soundscaper-mastering-sequence-copy.ts';
Object.assign(globalThis,{React});
const noop=()=>undefined;
test('the History panel localizes command operations and mixed batches without internal IDs',()=>{
	const html=renderToStaticMarkup(<WorkspacePanelContent panelId="history" controller={{}} snapshot={{history:{canUndo:true,canRedo:false,undoEntries:[{commands:['source/add','track/add','clip/add'],commandCount:3},{commands:['clip/update'],commandCount:1}]}}} copy={{...ENGLISH_COPY,historyBatch:'{count} Bearbeitungen',historyEditClip:'Clip bearbeiten'}} blocked={false} locale="de" fileService={{}} playbackMeterSettings={{}} run={noop} showArmControls={false} displayAudioSupported={false} onOpenEffects={noop} effectsPanelTarget={null} onEffectWindowChange={noop}/>);
	assert.ok(html.includes('3 Bearbeitungen'));assert.ok(html.includes('Clip bearbeiten'));assert.ok(!html.includes('source/add'));assert.ok(!html.includes('clip/update'));
});
test('missing capture hardware is classified and its primary status localized separately from diagnostics',()=>{
	const failure=captureSessionFailure(new DOMException('Requested device not found.','NotFoundError'),'permission-denied');
	assert.equal(failure.code,'device-lost');
	const capture:FramescaperCaptureUiSnapshot={phase:'failed',availability:{status:'available',sourceRoles:['camera']},requestedRoles:[],sources:[],sourcesFrozen:true,destination:null,countdownMs:null,permissionRequestGeneration:null,failure};
	const html=renderToStaticMarkup(<RecordingSetupPanel controller={{actions:{capture:{}}}} snapshot={{productId:'framescaper',capture}} copy={{...ENGLISH_COPY,captureFailureDeviceLost:'Das Aufnahmegerät ist nicht verfügbar.'}} locale="de" run={operation=>operation()}/>);
	const primary=/<div[^>]*role="status"[^>]*>(.*?)<\/div>/su.exec(html)?.[1]??'';
	assert.ok(primary.includes('Das Aufnahmegerät ist nicht verfügbar.'));assert.ok(!primary.includes('Requested device not found.'));assert.ok(html.includes('Requested device not found.'));
});
test('actual mastering repair warnings resolve stable domain codes in the selected language',()=>{
	const base=createSoundscaperProject({id:'album'});
	const project=createSoundscaperProject({...base,masteringSequences:[{id:'sequence',sequenceId:base.primarySequenceId,name:'Album',entries:[{id:'entry',annotationId:'missing-region'}]}]});
	const snapshot=createDocumentMasteringSequenceSnapshot(project);
	const html=renderToStaticMarkup(<Editor copy={{...SOUNDSCAPER_MASTERING_SEQUENCE_COPY,issueRegionMissing:'Die Region dieses Eintrags fehlt.'}} disabled={false} sequences={snapshot.sequences} regions={snapshot.regions} primarySequenceId={snapshot.primarySequenceId} createId={()=>'new'} onOperation={noop}/>);
	assert.ok(html.includes('Die Region dieses Eintrags fehlt.'));assert.ok(!html.includes('The region this entry delivers no longer exists.'));
});
