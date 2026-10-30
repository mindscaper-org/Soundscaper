/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { AdmMetadataFields } from '../src/common/editor/ui/AdmMetadataFields.tsx';
import { createDefaultAdmMetadata } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { AutomaticCrossfadeOverlays, createCrossfadeOverlays } from '../src/common/editor/ui/timeline/TrackOverlapOverlays.jsx';
import { analyzeVideoClipOverlaps, projectVideoOverlapPresentation } from '../src/common/editor/ui/timeline/video-overlap-presentation.ts';
import { EditorComponentCopyProvider } from '../src/common/editor/ui/EditorComponentCopyProvider.tsx';
import { resolveSoundscaperNativeServicesCopy } from '../src/common/editor/ui/soundscaper-native-services-copy.ts';
import { SoundscaperNativeEffectManagePanel } from '../src/common/editor/ui/dialogs/SoundscaperNativeEffectPanels.tsx';
import { EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, type SoundscaperNativeServicesDialogState } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import { createFramescaperNativeServicesSurfaceHost } from '../src/common/editor/ui/workspace/FramescaperNativeServicesSurface.tsx';
import type { FramescaperNativeServicesBridge } from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
Object.assign(globalThis, { React });
const noop = () => undefined;
test('ADM source channel descriptions localize around immutable strip names', () => {
	const project = {id:'adm',title:'ADM',revision:0,masterChannels:2,metadata:{adm:null},sources:[{id:'s',channelCount:2}],clips:[{id:'c',sourceId:'s'}],tracks:[{id:'t',name:'$& {channel}',type:'audio',clipIds:['c']}],mixer:{groups:[],sends:[],routes:{}}};
	const html = renderToStaticMarkup(<AdmMetadataFields project={project} value={createDefaultAdmMetadata(project)} copy={{...ENGLISH_COPY,'ui.adm.sourceChannel':'{name} — Kanal {channel}'}} onCommit={noop} />);
	assert.ok(html.includes('$&amp; {channel} — Kanal 1')); assert.ok(html.includes('$&amp; {channel} — Kanal 2'));
	assert.ok(!html.includes('— channel'));
});
test('audio and video overlaps localize valid and invalid descriptions from semantic names', () => {
	const copy = {'ui.designSystem.automaticCrossfade':'Überblendung {outgoing} → {incoming}','ui.designSystem.invalidVideoOverlap':'Ungültig {outgoing} → {incoming}'};
	const render = (overlays: readonly unknown[]) => renderToStaticMarkup(<EditorComponentCopyProvider copy={copy} locale="de"><AutomaticCrossfadeOverlays overlays={overlays} /></EditorComponentCopyProvider>);
	const audio = createCrossfadeOverlays([{id:'a',name:'$& A',isVisible:true,timelineStartFrame:0,durationFrames:100},{id:'b',name:'B',isVisible:true,timelineStartFrame:50,durationFrames:100}],0,100,100);
	assert.ok(render(audio).includes('Überblendung $&amp; A → B'));
	for(const invalid of [false,true]) {
		const clips = [{id:'a',title:'$& A',kind:'video',timelineStartFrame:0,durationFrames:invalid?300:100},{id:'b',title:'B',kind:'video',timelineStartFrame:50,durationFrames:100}];
		const model = projectVideoOverlapPresentation(analyzeVideoClipOverlaps(clips),0,200,100,100);
		assert.ok(render(model.overlays).includes(`${invalid?'Ungültig':'Überblendung'} $&amp; A → B`));
	}
});
test('native diagnostic numbers use localized templates and active number formatting', () => {
	const instance: NonNullable<SoundscaperNativeServicesDialogState['pluginInstance']> = {instanceId:'plugin_instance_ladspa',entryId:'effect',stablePluginId:'gain',format:'ladspa',binarySha256:'a'.repeat(64),inputChannels:2,outputChannels:2,state:'hosted',enabled:true,bypassed:false,latencySamples:1234};
	const state: SoundscaperNativeServicesDialogState = {...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,pluginInstance:instance,pluginOffline:{instance,blocksRendered:2500,renderedSha256:'b'.repeat(64)}};
	const html = renderToStaticMarkup(<EditorComponentCopyProvider copy={{}} locale="de"><SoundscaperNativeEffectManagePanel mode="use" state={state} copy={resolveSoundscaperNativeServicesCopy({'ui.soundscaperNative.latencyFrames':'Latenz: {count} Frames','ui.soundscaperNative.blocksRendered':'Blöcke: {count}'})} disabled={false} perform={noop} /></EditorComponentCopyProvider>);
	assert.ok(html.includes('Latenz: 1.234 Frames')); assert.ok(html.includes('Blöcke: 2.500')); assert.ok(!html.includes('latency frames'));
});
test('an existing native host refreshes its separate root with the new locale and copy', () => {
	const rendered: React.ReactNode[] = [];
	const host = createFramescaperNativeServicesSurfaceHost({bridge:{} as FramescaperNativeServicesBridge,copy:{close:'Close'},locale:'en',documentValue:{createElement:()=>({dataset:{},remove(){}}),body:{append(){}},querySelector:()=>null} as unknown as Document,createHostRoot:()=>({render:node=>rendered.push(node),unmount(){}})});
	try {
		host.open('background-jobs');
		host.setPresentation({close:'Schließen'},'de');
		const suspense = rendered.at(-1) as React.ReactElement<{children:React.ReactElement<{locale:string,copy:{close:string}}>}>
		assert.equal(suspense.props.children.props.locale,'de');assert.equal(suspense.props.children.props.copy.close,'Schließen');
	} finally { host.dispose(); }
});

test('the menu-owned Vamp catalog surface passes localized dialog copy and status', async () => {
	const { act } = await import('react'); const { createRoot } = await import('react-dom/client');
	const { installReactTestDom } = await import('./helpers/react-test-dom.ts');
	const { default: Surface } = await import('../src/common/editor/ui/workspace/SoundscaperVampAnalyzerSurface.tsx');
	await import('../src/common/editor/ui/dialogs/VampAnalyzerDialog.tsx');
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	let resolveCatalog!: (catalog: unknown) => void;
	const catalog = new Promise<unknown>(resolve => { resolveCatalog = resolve; });
	const bridge = {listNativeVampAnalyzers:()=>catalog,startNativeVampAnalyzer:async()=>({}),configureNativeVampAnalyzer:async()=>({}),pushNativeVampAnalyzerPcm:async()=>({}),finishNativeVampAnalyzer:async()=>({}),cancelNativeVampAnalyzer:async()=>true} as unknown as import('../src/common/editor/ui/soundscaper-native-services-bridge.ts').SoundscaperNativeServicesBridge;
	const controller = {project:{id:'vamp',revision:0,sampleRate:48000,selection:{startFrame:0,endFrame:48000,trackIds:['voice'],clipIds:[]},clips:[],tracks:[{id:'voice',type:'audio',clipIds:[]}]},actions:{edit:{commit:noop}}};
	try {
		await act(async () => root.render(<Surface input={{controller,durationFrames:48000,selectedTrackId:null,selectedClipId:null,bridge,engine:{} as import('../src/common/editor/engine/public-api.ts').EnginePublicApi,projectToken:controller.project}} copy={{'ui.vamp.title':'Analyse','ui.vamp.analyzer':'Analysator','ui.vamp.scope':'Bereich','ui.vamp.noAnalyzers':'Keine Analysatoren','ui.vamp.loadingCatalog':'Lädt Analysatoren'}} onClose={noop} />));
		for(let attempt=0;attempt<20&&!dom.find('[role="dialog"]');attempt++) await act(async () => { await new Promise<void>(resolve=>setImmediate(resolve)); });
		assert.equal(dom.one('[role="dialog"]').getAttribute('aria-label'),'Analyse');
		assert.ok(dom.container.textContent.includes('Lädt Analysatoren'));
		await act(async () => { resolveCatalog([{analyzerId:'onsets',stableId:'fixture',binarySha256:'ab'.repeat(32),name:'Authored $& Analyzer',maker:'Fixture',programs:[],parameters:[],outputs:[{id:'onsets',name:'Onsets',description:'',unit:'',sampleType:'one-sample-per-step',sampleRate:null,hasDuration:false}],configuration:{inputDomain:'time',minimumChannels:1,maximumChannels:2,preferredStepSize:2,preferredBlockSize:4}}]); await catalog; });
		for(const label of ['Analysator','Bereich','Authored $& Analyzer']) assert.ok(dom.container.textContent.includes(label),label);
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
