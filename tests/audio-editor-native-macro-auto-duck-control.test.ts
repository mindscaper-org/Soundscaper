/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEffectMacroDraft, parseAudacityEffectMacro, serializeAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import { createEffectMacroStep } from '../src/common/editor/effect-macro-steps.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { localizedErrorMessage } from '../src/common/i18n/presentation-message.ts';
import { bindNativeAutoDuckControls } from '../src/common/editor/controller/effects/internal/macro/macro-target-admission.ts';
import { createHarness } from './helpers/effect-macro-service-fixture.ts';

const native = 'AutoDuck:DuckAmountDb="-12" InnerFadeDownLen="0" InnerFadeUpLen="0" OuterFadeDownLen="0.01" OuterFadeUpLen="0.01" ThresholdDb="-30" MaximumPause="0.1"';
const policy = { audacityControlTrackPolicy: 'below-last-selected-audio' };

test('native AutoDuck parser retains its implicit control authority', () => {
	const effect = parseAudacityEffectMacro(native).effects[0]; assert.ok(effect);
	assert.deepEqual(effect.context, policy);
});

test('local explicit AutoDuck control cannot silently become a different native binding', () => {
	const effect=createEffectMacroStep('audacity-auto-duck',{context:{controlTrackId:'voice'}});
	assert.throws(()=>serializeAudacityEffectMacro([effect]),/Auto Duck.*control/iu);
});

test('native AutoDuck materializes the lower voice instead of an unrelated preceding lane', async () => {
	const ids=['silent','music','voice'];
	const project=createSoundscaperProject({sampleRate:48000,
		sources:ids.map(id=>({id:'s-'+id,name:id,sampleRate:48000,frameCount:48000,channelCount:1,sampleFormat:'float32',storageKey:'s-'+id})),
		clips:ids.map(id=>({id:'c-'+id,sourceId:'s-'+id,durationFrames:48000})),
		tracks:ids.map(id=>({id,type:'audio',name:id,clipIds:['c-'+id]})),
		selection:{startFrame:100,endFrame:300,trackIds:['music'],clipIds:[]}});
	const stop=new Error('Captured before rendering');const effects:Readonly<Record<string,unknown>>[]=[];
	const h=createHarness({project:{...project},targetTrackId:'music',projectSampleRate:48000,onMaterialize(effect){effects.push(effect);throw stop;}});
	await assert.rejects(h.service.runEffectMacro({effects:[{id:'duck',type:'audacity-auto-duck',params:{outerFadeDown:0,outerFadeUp:0},context:policy}]}),stop);
	assert.deepEqual(effects[0]?.context,{...policy,controlTrackId:'voice'});
});

test('ordinary native effects and local AutoDuck context remain available', () => {
	assert.equal(serializeAudacityEffectMacro(parseAudacityEffectMacro('Invert:').effects),'Invert:\n');
	assert.deepEqual(createEffectMacroStep('audacity-auto-duck',{context:{controlTrackId:'voice'}}).context,{controlTrackId:'voice'});
});

const effect = parseAudacityEffectMacro(native).effects[0]; assert.ok(effect);
function projectWithTracks(rows: readonly string[], selected: readonly string[]) {
	const audio=rows.filter(id=>!id.startsWith('label-')&&!id.startsWith('empty-'));
	const created=createSoundscaperProject({sampleRate:48000,
		sources:audio.map(id=>({id:'s-'+id,name:id,sampleRate:48000,frameCount:48000,channelCount:1,sampleFormat:'float32',storageKey:'s-'+id})),
		clips:audio.map(id=>({id:'c-'+id,sourceId:'s-'+id,durationFrames:48000})),
		tracks:rows.map(id=>id.startsWith('label-')?{id,type:'label',name:id,labels:[]}:{id,type:'audio',name:id,clipIds:audio.includes(id)?['c-'+id]:[]}),
		selection:{startFrame:100,endFrame:300,trackIds:selected,clipIds:[]}});
	return {...created,tracks:created.tracks.map(track=>({...track}))};
}
for(const [name,rows,selected,targets,expected] of [
	['preceding unrelated audio',['silent','music','voice'],['music'],['music'],'voice'],
	['whole selected set',['music-a','silence','music-b','voice'],['music-a','music-b'],['music-a','music-b'],'voice'],
	['selected empty audio still controls ordering',['music','empty-target','voice'],['music','empty-target'],['music'],'voice'],
	['unselected empty audio is the immediate control',['music','empty-control','voice'],['music'],['music'],'empty-control'],
	['later label does not invalidate a real control',['music','voice','label-tail'],['music'],['music'],'voice'],
	['intervening label blocks later audio',['music','label-gap','voice'],['music'],['music'],null],
	['selected label is invalid',['label-selected','music','voice'],['label-selected','music'],['music'],null],
	['last selected empty audio has no lower control',['music','voice','empty-target'],['music','empty-target'],['music'],null],
	['missing control below last track',['voice','music'],['music'],['music'],null],
] as const) test(name,()=>{
	const input=[effect];const before=structuredClone(input);
	const bound=bindNativeAutoDuckControls(input,projectWithTracks(rows,selected),targets.map(id=>({track:{id}})),false);
	assert.deepEqual(input,before);
	if(expected===null)assert.ok(bound.refusal);
	else {assert.equal(bound.refusal,null);assert.deepEqual(bound.effects.map(e=>e.context),[{audacityControlTrackPolicy:'below-last-selected-audio',controlTrackId:expected}]);}
});

test('explicit/source editor targets use their real owner instead of a different timeline selection',()=>{
	const input=projectWithTracks(['music','voice'],['voice']);
	for(const source of [false,true]) {
		const bound=bindNativeAutoDuckControls([effect],input,[source?{track:{id:'source-editor:music'},sourceTrackId:'music'}:{track:{id:'music'}}],!source);
		assert.equal(bound.refusal,null);assert.deepEqual(bound.effects[0]?.context,{audacityControlTrackPolicy:'below-last-selected-audio',controlTrackId:'voice'});
	}
});

test('local default and explicit control policies remain unchanged',()=>{
	const local=[createEffectMacroStep('audacity-auto-duck'),createEffectMacroStep('audacity-auto-duck',{context:{controlTrackId:'silent'}})];
	const result=bindNativeAutoDuckControls(local,projectWithTracks(['silent','music'],['music']),[{track:{id:'music'}}],false);
	assert.equal(result.refusal,null);assert.equal(result.effects,local);
});

test('an ownerless Source target cannot borrow the unrelated timeline selection',()=>{
	const bound=bindNativeAutoDuckControls([effect],projectWithTracks(['music','voice'],['music']),[{track:{id:'source-editor:bin-audio'},sourceId:'unowned-source'}],false);
	assert.equal(bound.refusal,'control');
});

test('native provenance survives library JSON and native re-export',()=>{
	const imported=parseAudacityEffectMacro(native);
	const draft=normalizeEffectMacroDraft({name:'Native duck',effects:JSON.parse(JSON.stringify(imported.effects))});
	assert.deepEqual(draft.effects[0]?.context,policy);
	const reopened=parseAudacityEffectMacro(serializeAudacityEffectMacro(draft.effects));
	assert.deepEqual(reopened.effects[0]?.context,policy);
});

for(const selectedLabel of [false,true]) test(`native admission refuses ${selectedLabel?'selected labels':'a missing lower control'} before materialization`,async()=>{
	const rows=selectedLabel?['label-selected','music','voice']:['voice','music'];
	const selected=selectedLabel?['label-selected','music']:['music'];
	const calls:unknown[]=[];
	const h=createHarness({project:projectWithTracks(rows,selected),targetTrackId:'music',projectSampleRate:48000,onMaterialize(effect){calls.push(effect);}});
	await assert.rejects(h.service.runEffectMacro({effects:parseAudacityEffectMacro(native).effects}),error=>{
		assert.equal(localizedErrorMessage(error)?.key,selectedLabel?'audioTrackRequired':'macroAutoDuckNativeControl');return true;
	});
	assert.deepEqual(calls,[]);
});

test('native control is resolved for all selected targets before materializing the first',async()=>{
	const effects:Readonly<Record<string,unknown>>[]=[];const stop=new Error('Captured before rendering');
	const h=createHarness({project:projectWithTracks(['music-a','music-b','voice'],['music-a','music-b']),multipleTargets:true,projectSampleRate:48000,onMaterialize(effect){effects.push(effect);throw stop;}});
	await assert.rejects(h.service.runEffectMacro({effects:parseAudacityEffectMacro(native).effects}),stop);
	assert.deepEqual(effects[0]?.context,{...policy,controlTrackId:'voice'});
});

test('native control cannot bind an audio lane from the following hidden sequence',()=>{
	const base=projectWithTracks(['music','foreign'],['music']);
	const scoped=createSoundscaperProject({...base,sequences:[
		{id:'main-sequence',trackIds:['music']},
		{id:'other-sequence',trackIds:['foreign']},
	]});
	const bound=bindNativeAutoDuckControls([effect],{...scoped,tracks:scoped.tracks.map(track=>({...track}))},[{track:{id:'music'}}],false);
	assert.equal(bound.refusal,'control');
});

test('native control uses a Source owner sequence and refuses a cross-sequence selected set',()=>{
	const base=projectWithTracks(['music-a','voice-a','music-b','voice-b'],['music-a','music-b']);
	const scoped=createSoundscaperProject({...base,sequences:[
		{id:'main-sequence',trackIds:['music-a','voice-a']},
		{id:'other-sequence',trackIds:['music-b','voice-b']},
	]});
	const project={...scoped,tracks:scoped.tracks.map(track=>({...track}))};
	const target={track:{id:'source-editor:music-b'},sourceTrackId:'music-b'};
	const source=bindNativeAutoDuckControls([effect],project,[target],false);
	assert.equal(source.refusal,null);
	assert.deepEqual(source.effects[0]?.context,{...policy,controlTrackId:'voice-b'});
	assert.equal(bindNativeAutoDuckControls([effect],project,[{track:{id:'music-a'}},{track:{id:'music-b'}}],false).refusal,'selection');
});
