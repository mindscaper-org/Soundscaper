/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';

for (const [label, expected] of [['Room microphone', 'Room microphone'], ['  Room &amp; choir 🎙️  ', '  Room & choir 🎙️  '], ['', 'encoded.wav'], ['   ', 'encoded.wav'], ['Room&#10;microphone', 'Room\nmicrophone'], ['Speech.mp3', 'Speech.mp3']] as const) {
	test(`DAWproject File Open retains the authored media label ${JSON.stringify(label)}`, async () => {
		const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Media labels</Title></MetaData>',
			projectXml: `<Project version="1.0"><Application name="Media labels" version="1"/><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".1"><Audio name="${label}" channels="1" sampleRate="48000" duration=".1" timeUnit="seconds"><File path="audio/encoded.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
			files: [{ path: 'audio/encoded.wav', blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, float: true }))]) }] });
		const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject });
		const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Media labels.dawproject'));
		assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
		const source = opened.project.sources[0]; assert.ok(source?.kind === 'audio');
		assert.equal(source.name, expected, 'a media label is independent of the portable ZIP member filename');
		const origin = normalizeSourceProvenance(source.provenance).contributions[0]?.origin;
		assert.equal(source.mimeType, 'audio/wav', 'display-label suffixes cannot redefine the encoded file identity');
		assert.ok(origin?.kind === 'local-file'); assert.equal(origin.originalFileName, 'encoded.wav', 'the actual original filename stays separately truthful');
		const clip = opened.project.clips[0]; assert.ok(clip?.kind === 'audio');
		assert.equal(clip.title, expected, 'an untitled clip displays its own authored media label');
		assert.equal(clip.durationFrames, 4800);
	});
}

test('DAWproject media labels remain occurrence-specific when the same physical audio is referenced twice', async () => {
	const clips = '<Clip time="0" duration=".1" name="Authored occurrence"><Audio name="First label" channels="1" sampleRate="48000" duration=".1" timeUnit="seconds"><File path="audio/encoded.wav"/></Audio></Clip>'
		+ '<Clip time=".1" duration=".1"><Audio name="Second label" channels="1" sampleRate="48000" duration=".1" timeUnit="seconds"><File path="audio/encoded.wav"/></Audio></Clip>';
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
		projectXml: `<Project version="1.0"><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips>${clips}</Clips></Lanes></Lanes></Arrangement></Project>`,
		files: [{ path: 'audio/encoded.wav', blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, float: true }))]) }] });
	let id = 0;
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject, createStableId: prefix => `${prefix}-${++id}` });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Shared media.dawproject'));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	assert.equal(opened.project.sources.length, 1);
	assert.deepEqual(opened.project.clips.map(clip => clip.kind === 'audio' ? clip.title : ''), ['Authored occurrence', 'Second label']);
});

test('File Export DAWproject carries the native source label separately from its safe embedded filename', async () => {
	const project = createSoundscaperProject({ id: 'label-export', sources: [{ id: 'source', name: 'Room microphone 🎙️.wav', frameCount: 4800, channelCount: 1, sampleRate: 48_000 }],
		tracks: [{ type: 'audio', id: 'voice', name: 'Voice', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'source', title: 'Authored occurrence', durationFrames: 4800, sourceDurationFrames: 4800 }] });
	const delivered: Blob[] = [];
	const fixture = createFixture({ getProject: () => project, loadStoredSourceChannels: async () => [new Float32Array(4800).fill(.25)],
		fileService: { isDesktop: false, chooseSaveTarget: async () => null, prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
			saveFile: async request => { assert.ok(request.blob instanceof Blob); delivered.push(request.blob); return { fileName: request.suggestedName }; } } });
	fixture.replaceProject(project.id); await createNativeProjectService(fixture.runtime).saveDawproject();
	assert.equal(delivered.length, 1);
	const reader = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(reader.runtime).openDawproject(new File([delivered[0]!], 'Round trip.dawproject'));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	assert.equal(opened.project.sources[0]?.name, 'Room microphone 🎙️.wav');
	const clip = opened.project.clips[0]; assert.ok(clip?.kind === 'audio'); assert.equal(clip.title, 'Authored occurrence');
	const origin = normalizeSourceProvenance(opened.project.sources[0]?.provenance).contributions[0]?.origin;
	assert.ok(origin?.kind === 'local-file'); assert.notEqual(origin.originalFileName, project.sources[0]?.name, 'the encoded portable filename is still a truthful distinct identity');
});
