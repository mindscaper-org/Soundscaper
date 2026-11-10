/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { clipboardDocument, clipboardPcm, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

async function session(context: TestContext) {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const engine = { ...createMemoryEngine(), async decodeAudioData() { throw new DOMException('Native audio decoding is unavailable in Node.', 'NotSupportedError'); } };
	const ffmpeg = { ...createMemoryFfmpeg(), async decode() { throw new Error('Invalid RIFF audio has no decodable PCM.'); } };
	return await controllerSession(context, { adaptAudacityProject: importSoundscaperAudacityProject,
		engine: engine as unknown as Options['engine'], ffmpeg: ffmpeg as unknown as Options['ffmpeg'],
		engineFactory: () => { throw new Error('File batch custody must not synthesize decoded or rendered PCM.'); } });
}

function wav(name: string, pcm: Float32Array) {
	const bytes = encodeWav([pcm], { sampleRate: 48_000, float: true }); assert.ok(bytes instanceof Uint8Array);
	return new File([Uint8Array.from(bytes)], name, { type: 'audio/wav' });
}

for (const mixed of [false, true]) test(`${mixed ? 'mixed' : 'all-failed'} real WAV import preserves truthful diagnostics, atomic history and native archive PCM`, async context => {
	const { controller, store } = await session(context);
	const before = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries;
	const pcm = clipboardPcm(4800), broken = (name: string) => new File(['no decodable audio'], name, { type: 'audio/wav' });
	await controller.actions.project.importFiles(mixed ? [broken('Broken A.wav'), wav('Healthy.wav', pcm), broken('Broken B.wav')]
		: [broken('Broken recording.wav')], { destination: 'timeline' });
	const edited = clipboardProject(controller.project), status = controller.getSnapshot().status;
	assert.equal(status.state, 'error'); assert.match(status.message, mixed ? /1 file\(s\) imported, 2 failed/u : /0 file\(s\) imported, 1 failed/u);
	for (const name of mixed ? ['Broken A.wav', 'Broken B.wav'] : ['Broken recording.wav']) assert.ok(status.message.includes(name));
	assert.match(status.message, /RIFF|decod|supported/iu);
	assert.equal(edited.sources.length, mixed ? 1 : 0); assert.equal(edited.clips.length, mixed ? 1 : 0);
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries.length + (mixed ? 1 : 0));
	if (mixed) {
		const source = edited.sources[0], clip = edited.clips[0]; assert.ok(source?.kind === 'audio' && clip?.kind === 'audio');
		assert.deepEqual([source.name, source.sampleRate, source.frameCount, source.channelCount], ['Healthy.wav', 48_000, 4800, 1]);
		assert.deepEqual([clip.sourceId, clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.sourceDurationFrames], [source.id, 0, 0, 4800, 4800]);
		await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	} else {
		assert.deepEqual(edited, before); assert.deepEqual(controller.getSnapshot().history.undoEntries, entries);
	}
	await controller.actions.project.flush();
	await assertAudioProjectArchivePcm(context, store, controller.project, (_name, channels) => assertPcmChannelsEqual(channels, [pcm]));
});

for (const format of ['legacy48000', 'legacy44100', 'media'] as const)
	test(`${format} batch routes actual original PCM to the incoming project clock and independent Scape`, async context => {
		const { controller, store } = await session(context), outgoingPcm = new Float32Array(9600).fill(.125);
		await controller.actions.project.importFiles([wav('Outgoing.wav', outgoingPcm)], { destination: 'timeline' });
		await controller.actions.project.flush();
		const outgoing = clipboardProject(controller.project), target = outgoing.tracks.find(track => track.type === 'audio' && track.clipIds.length > 0); assert.ok(target?.type === 'audio');
		const pcm = clipboardPcm(4800), audio = wav('Independent.wav', pcm), incomingRate = format === 'legacy44100' ? 44_100 : 48_000;
		let files: File[];
		if (format === 'media') files = [audio];
		else {
			const { projectFile, dataFile } = legacyAupFiles('utf-8');
			const xml = (await projectFile.text()).replaceAll('rate="48000"', `rate="${incomingRate}"`);
			const block = await dataFile.arrayBuffer(); new DataView(block).setUint32(16, incomingRate);
			files = [new File([xml], projectFile.name, { type: projectFile.type }), new File([block], dataFile.name), audio];
		}
		await importWorkspaceRoutedFiles({ controller, files,
			importOptions: { destination: 'timeline', trackId: target.id, timelineStartFrame: 48_000 }, projectBinVisible: false,
			openProjectFile: () => { throw new Error('Legacy projects with AU blocks must use their actual batch importer.'); },
			requestCueImport: () => { throw new Error('The fixture has no CUE sheet.'); } });
		const edited = clipboardProject(controller.project);
		assert.equal(edited.sampleRate, incomingRate); assert.equal(edited.clips.length, 2); assert.equal(edited.sources.length, 2);
		const clip = edited.clips.find(value => value.title === 'Independent.wav' || value.title === 'Independent'); assert.ok(clip?.kind === 'audio');
		const source = edited.sources.find(value => value.id === clip.sourceId); assert.ok(source?.kind === 'audio');
		assert.deepEqual([source.name, source.sampleRate, source.frameCount, source.channelCount], ['Independent.wav', 48_000, 4800, 1]);
		assert.deepEqual([clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames], [incomingRate, incomingRate / 10, 0, 4800]);
		const owner = edited.tracks.find(track => track.type === 'audio' && track.clipIds.includes(clip.id)); assert.ok(owner?.type === 'audio');
		if (format === 'media') { assert.equal(edited.id, outgoing.id); assert.equal(owner.id, target.id); }
		else {
			assert.notEqual(edited.id, outgoing.id); assert.notEqual(owner.id, target.id);
			assert.ok(edited.clips.every(value => value.title !== 'Outgoing.wav' && value.title !== 'Outgoing'));
			const legacy = edited.sources.find(value => value.id !== source.id); assert.ok(legacy?.kind === 'audio');
			assert.deepEqual([legacy.sampleRate, legacy.frameCount, legacy.channelCount], [incomingRate, 4800, 1]);
			assert.deepEqual(await store.loadProject(outgoing.id), outgoing);
		}
		await controller.actions.project.flush();
		await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
			const expected = name === source.name ? pcm : format === 'media' ? outgoingPcm
				: Float32Array.from({ length: 4800 }, (_value, index) => index % 2 ? -.25 : .25);
			assertPcmChannelsEqual(channels, [expected]);
		});
	});
