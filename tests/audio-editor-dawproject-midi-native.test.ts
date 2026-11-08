/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { readMidiClip, readMidiTrack, withMidiClipData, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

function ids() { let next = 0; return (prefix: string) => `${prefix}-${++next}`; }
const notes = [{ id: 'note', pitch: 64, startFrame: 2000, durationFrames: 4000, velocity: 93, releaseVelocity: 25, channel: 3, midiPort: 2 }];
function fixture() {
	return createAudioEditorProjectV17({ sampleRate: 8000,
		sources: [createAudioSource({ id: 'source', frameCount: 16000, channelCount: 1, sampleRate: 8000 })],
		clips: [withMidiClipData(createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 8000,
			sourceStartFrame: 0, sourceDurationFrames: 16000, durationFrames: 16000 }), { version: 1, notes,
			interchange: { events: [{ frame: 1000, status: 0xb3, data: [1, 76] }], tempos: [], signatures: [] } })],
		tracks: [withMidiTrackData(createAudioTrack({ id: 'track', name: 'Keys', clipIds: ['clip'] }, 8000), { version: 1, instrument: 'square', program: 18 })],
	});
}

test('DAWproject writes editable standard Notes and restores messages and instrument metadata', () => {
	const exported = createDawprojectExport({ project: fixture() });
	assert.match(exported.projectXml, /contentType="notes"/u);
	assert.match(exported.projectXml, /<Note time="0.25" duration="0.5" channel="3" key="64" vel=/u);
	assert.equal(exported.media.length, 0);
	const imported = buildDawprojectProject(parseDawprojectDocument(exported.projectXml, exported.metadataXml), {
		media: new Map(), sampleRate: 8000, createStableId: ids(),
	});
	const project = createCurrentAudioEditorProject(imported.project as never);
	assert.ok(validateAudioEditorProjectV17(project));
	assert.deepEqual(readMidiClip(project.clips[0])?.notes, notes);
	assert.deepEqual(readMidiClip(project.clips[0])?.interchange?.events, [{ frame: 1000, status: 0xb3, data: [1, 76] }]);
	assert.deepEqual(readMidiTrack(project.tracks[0]), { version: 1, instrument: 'square', program: 18 });
	assert.equal(imported.midiSources.length, 1);
});

test('foreign DAWproject note clips use their beat clock, playStart and containing window', () => {
	const document = parseDawprojectDocument(`<Project version="1.0"><Application name="Foreign" version="1"/>
<Transport><Tempo unit="bpm" value="120"/></Transport><Structure><Track id="t" contentType="notes" name="Synth"/></Structure>
<Arrangement><Lanes timeUnit="beats"><Lanes track="t"><Clips><Clip time="4" duration="2" playStart="1">
<Notes><Note time="0" duration="2" key="60" channel="2" vel="0.5" rel="0.25"/>
<Note time="2" duration="3" key="67" channel="2" vel="1"/></Notes></Clip></Clips></Lanes></Lanes></Arrangement></Project>`);
	const plan = buildDawprojectProject(document, { media: new Map(), sampleRate: 8000, createStableId: ids() });
	const project = createCurrentAudioEditorProject(plan.project as never);
	assert.ok(validateAudioEditorProjectV17(project));
	assert.equal(project.clips[0]?.timelineStartFrame, 16000);
	assert.equal(project.clips[0]?.durationFrames, 8000);
	assert.deepEqual(readMidiClip(project.clips[0])?.notes.map(note => [note.pitch, note.startFrame, note.durationFrames, note.velocity, note.releaseVelocity]),
		[[60, 0, 4000, 64, 32], [67, 4000, 4000, 127, undefined]]);
	assert.ok(plan.report.items.some(item => item.code === 'dawproject.midi-instrument-converted'));
});

test('MIDI export projects source trim and duration onto editable note placement', () => {
	const project = fixture();
	const clip = { ...project.clips[0]!, sourceStartFrame: 3000, sourceDurationFrames: 6000, durationFrames: 12000 };
	const exported = createDawprojectExport({ project: { ...project, clips: [clip] } });
	const plan = buildDawprojectProject(parseDawprojectDocument(exported.projectXml), { media: new Map(), sampleRate: 8000, createStableId: ids() });
	const imported = createCurrentAudioEditorProject(plan.project as never);
	const [note] = readMidiClip(imported.clips[0])!.notes;
	assert.equal(note!.startFrame, 0);
	assert.equal(note!.durationFrames, 6000);
});

test('malformed native note attributes fail before project publication', () => {
	const xml = `<Project version="1.0"><Application name="x" version="1"/><Arrangement><Lanes><Clips><Clip time="0" duration="4"><Notes><Note time="0" duration="1" key="999" channel="0"/></Notes></Clip></Clips></Lanes></Arrangement></Project>`;
	assert.throws(() => buildDawprojectProject(parseDawprojectDocument(xml), { media: new Map(), createStableId: ids() }), /key|pitch|MIDI/iu);
});

test('DAWproject MIDI opens as an editable project in the active Framescaper family', async () => {
	const { createFixture } = await import('./helpers/native-project-service-fixture.ts');
	const { createNativeProjectService } = await import('../src/common/editor/controller/document/native-project-service.ts');
	const { writeDawprojectArchive } = await import('../src/common/editor/dawproject-archive.ts');
	const exported = createDawprojectExport({ project: fixture() });
	const archive = await writeDawprojectArchive({ projectXml: exported.projectXml, metadataXml: exported.metadataXml, files: [] });
	const base = createFixture({ createStableId: ids(),
		createImportedProject: options => createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, options as never),
		loadProject: () => assert.fail('a source-derived import is constructed in the active family'),
	});
	const result = await createNativeProjectService(base.runtime).openDawproject(new File([archive], 'notes.dawproject'));
	assert.ok(result); assert.equal(result.project.schemaFamily, 'framescaper');
	assert.ok(readMidiClip(result.project.clips[0])?.notes.length);
});

test('import persists audible synthesized MIDI chunks before activating the project', async () => {
	const { createFixture } = await import('./helpers/native-project-service-fixture.ts');
	const { createNativeProjectService } = await import('../src/common/editor/controller/document/native-project-service.ts');
	const { writeDawprojectArchive } = await import('../src/common/editor/dawproject-archive.ts');
	const exported = createDawprojectExport({ project: fixture() });
	const archive = await writeDawprojectArchive({ projectXml: exported.projectXml, metadataXml: exported.metadataXml, files: [] });
	const base = createFixture();
	const chunks: Float32Array[] = [];
	let committed = false;
	const runtime = { ...base.runtime, store: { ...base.runtime.store,
		beginSourceWrite: async () => ({ write: async (channels: readonly Float32Array[]) => { chunks.push(channels[0]!); },
			commit: async () => { committed = true; }, abort: async () => undefined }),
	}, switchProject: async (project: Parameters<typeof base.runtime.switchProject>[0]) => {
		assert.equal(committed, true);
		assert.ok(chunks.some(chunk => chunk.some(sample => Math.abs(sample) > 0.01)));
		await base.runtime.switchProject(project, { readOnly: false, save: true });
	} };
	const result = await createNativeProjectService(runtime).openDawproject(new File([archive], 'notes.dawproject'));
	assert.ok(result);
	assert.equal(base.deletedSources.length, 0);
	const source = result.project.sources[0];
	assert.ok(source && source.kind !== 'video' && source.kind !== 'image');
	assert.equal(chunks.reduce((size, chunk) => size + chunk.length, 0), source.frameCount);
});

test('failed MIDI project activation deletes its newly synthesized source', async () => {
	const { createFixture } = await import('./helpers/native-project-service-fixture.ts');
	const { createNativeProjectService } = await import('../src/common/editor/controller/document/native-project-service.ts');
	const { writeDawprojectArchive } = await import('../src/common/editor/dawproject-archive.ts');
	const exported = createDawprojectExport({ project: fixture() });
	const archive = await writeDawprojectArchive({ projectXml: exported.projectXml, metadataXml: exported.metadataXml, files: [] });
	const base = createFixture({ switchProject: async () => { throw new Error('activation refused'); } });
	await assert.rejects(createNativeProjectService(base.runtime).openDawproject(new File([archive], 'notes.dawproject')), /activation refused/u);
	assert.deepEqual(base.deletedSources, ['source-native']);
	assert.equal(base.runtime.getProject()?.id, 'project-a');
	assert.equal(base.state.importing, false);
});

test('empty MIDI tracks and fallback fades retain their authoring state', () => {
	const project = fixture();
	const exported = createDawprojectExport({ project: { ...project,
		clips: [{ ...project.clips[0]!, fadeInFrames: 100, fadeOutFrames: 300 }],
		tracks: [...project.tracks, withMidiTrackData(createAudioTrack({ id: 'empty', name: 'Empty', clipIds: [] }, 8000),
			{ version: 1, instrument: 'sine', program: 42 })] } });
	const plan = buildDawprojectProject(parseDawprojectDocument(exported.projectXml), { media: new Map(), sampleRate: 8000, createStableId: ids() });
	const imported = createCurrentAudioEditorProject(plan.project as never);
	assert.equal(imported.clips[0]?.fadeInFrames, 100);
	assert.equal(imported.clips[0]?.fadeOutFrames, 300);
	assert.deepEqual(readMidiTrack(imported.tracks[1]), { version: 1, instrument: 'sine', program: 42 });
});

test('Audacity project export reports converting MIDI authoring to its audible PCM fallback', async () => {
	const { createAup4ExportPlan } = await import('../src/common/editor/aup4-export.js');
	const exported = createAup4ExportPlan(fixture());
	const item = exported.compatibilityReport.items.find((entry: { code: string }) => entry.code === 'MIDI_AUTHORING_CONVERTED');
	assert.equal(item?.disposition, 'converted');
	assert.equal(item?.data?.notes, 1);
	assert.match(item?.message ?? '', /MIDI.*audio/iu);
});
