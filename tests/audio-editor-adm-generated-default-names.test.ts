/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { normalizeAdmProjectMetadata } from '../src/common/editor/adm-project-metadata.ts';
import { addAdmEditorObject, createDefaultAdmMetadata, createProjectAdmEditorValue, listAdmEditorSourceChannels, setAdmEditorObject } from '../src/common/editor/ui/adm-metadata-editor-model.ts';

for (const [title, expected] of [
 ['Opening Room tone', 'Opening Room tone'], ['Opening\nRoom tone', 'Opening Room tone'],
 ['Opening\r\nRoom\ttone', 'Opening  Room tone'], ['夜の音楽 🎵', '夜の音楽 🎵'],
 ['楽'.repeat(200), '楽'.repeat(170)], ['🎵'.repeat(200), '🎵'.repeat(128)], ['\n\r\t', 'Programme'],
] as const) test(`ADM Enable derives a valid programme default for ${JSON.stringify(title.slice(0, 25))}`, () => {
 const project=fixture(title);
 const adm=createDefaultAdmMetadata(project);
 assert.equal(adm.programme.name,expected);
 assert.deepEqual(adm.bed.assignments.map(value=>value.bedChannel),['L']);
 assert.equal(project.metadata.title,title,'deriving an ADM seed must not rewrite project descriptive metadata');
 assert.deepEqual(normalizeAdmProjectMetadata(adm),adm);
});

for (const trackName of ['Dialogue', 'Opening\nRoom tone', '楽'.repeat(200), '🎵'.repeat(200)]) test(`ADM Add object derives a valid default for ${JSON.stringify(trackName.slice(0, 25))}`, () => {
 const project=fixture('Ordinary programme',trackName), source=listAdmEditorSourceChannels(project)[0];
 assert.ok(source);
 const adm=addAdmEditorObject(createDefaultAdmMetadata(project),source,()=> 'object');
 const object=adm.objects?.[0];assert.ok(object);
 assert.equal(object.stripId,'track');assert.equal(object.sourceChannel,0);
 assert.ok(object.name.length>0);assert.ok(new TextEncoder().encode(object.name).byteLength<=512);
 assert.equal(Array.from(object.name).some(character => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f || character === '\ufffd'), false);
 if(trackName==='Dialogue') assert.equal(object.name,'Dialogue — channel 1');
 if(trackName.includes('\n')) assert.equal(object.name,'Opening Room tone — channel 1');
 assert.equal(project.tracks[0]?.name,trackName);
});

test('ADM derivation retains the existing project-title fallback and explicit valid names', () => {
 const project=fixture('');
 const adm=createDefaultAdmMetadata(project);
 assert.equal(adm.programme.name,'Project title');
 const authored=normalizeAdmProjectMetadata({...adm,programme:{name:'Explicit programme',language:'und'}});
 const saved=createProjectAdmEditorValue({...project,metadata:{adm:authored}});
 assert.deepEqual(saved,authored);
});

test('ADM explicit user edits and imported metadata retain strict invalid-name refusal', () => {
 const project=fixture('Ordinary programme'), source=listAdmEditorSourceChannels(project)[0];assert.ok(source);
 const authored=addAdmEditorObject(createDefaultAdmMetadata(project),source,()=> 'object');
 assert.throws(()=>setAdmEditorObject(authored,'object',{name:'Explicit\nname'}),/control characters/u);
 assert.throws(()=>setAdmEditorObject(authored,'object',{name:'楽'.repeat(200)}),/too large/u);
 assert.throws(()=>createProjectAdmEditorValue({...project,metadata:{adm:{...authored,programme:{name:'Imported\nname',language:''}}}}),/control characters/u);
});

function fixture(title:string, name='Dialogue') {
 const source=createAudioSource({id:'source',sampleRate:48000,frameCount:4800,channelCount:1});
 const clip=createAudioClip({id:'clip',sourceId:source.id,durationFrames:4800,sourceDurationFrames:4800});
 const track=createAudioTrack({id:'track',name,clipIds:[clip.id]});
 return createCurrentAudioEditorProject({id:'adm-default',title:'Project title',sampleRate:48000,masterChannels:2,metadata:{title},sources:[source],clips:[clip],tracks:[track]});
}
