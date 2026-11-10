/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { readWithReference } from './helpers/interchange-reference.ts';

function recordedBedFile(): File {
	const channels = [new Float32Array(38_400).fill(.125), new Float32Array(38_400).fill(-.25)];
	const bytes = Uint8Array.from(encodeWav(channels, { sampleRate: 48_000, bitDepth: 32, float: true, dither: false }));
	return new File([bytes], 'Recorded bed.wav', { type: 'audio/wav' });
}

for (const overlap of [false, true]) test(`actual FCPXML bin placement overlap=${overlap} preserves literal track clocks, PCM, history and Scape file delivery`, async context => {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const saved: File[] = [];
	const options = { scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: { ...createMemoryEngine(), decodeAudioData: () => { throw new Error('Real bounded WAV decoding is required.'); } } as unknown as Options['engine'],
		ffmpeg: { ...createMemoryFfmpeg(), decode: () => { throw new Error('No substitute WAV decoder is permitted.'); }, encode: () => { throw new Error('Interchange custody does not encode PCM.'); } } as unknown as Options['ffmpeg'],
		engineFactory: () => assert.fail('Interchange custody does not render PCM'),
		fileService: { ...createAudioEditorFileService(), async saveFile(request: unknown) {
			assert.ok(request && typeof request === 'object');
			const blob = Reflect.get(request, 'blob'), name = Reflect.get(request, 'suggestedName');
			assert.ok(blob instanceof Blob && typeof name === 'string');
			saved.push(new File([blob], name, { type: blob.type })); return { method: 'node-fixture', fileName: name, size: blob.size };
		} } };
	const sender = await controllerSession(context, options);
	await sender.controller.actions.project.importFiles([recordedBedFile()],
		{ destination: 'project-bin', projectBinVisible: true });
	const imported = sender.controller.project; assert.ok(validateSoundscaperProject(imported));
	assert.equal(imported.clips.length, 0); assert.equal(imported.projectBin.clips.length, 1); assert.equal(imported.sources.length, 1);
	const bin = imported.projectBin.clips[0]; assert.ok(bin);
	const first = await sender.controller.actions.projectBin.place(bin.id, { timelineStartFrame: 0 }); assert.ok(first);
	const placed = sender.controller.project; assert.ok(validateSoundscaperProject(placed));
	const track = placed.tracks.find(track => track.type === 'audio' && track.clipIds.includes(first)); assert.ok(track?.type === 'audio');
	const history = sender.controller.getSnapshot().history.undoEntries.length;
	await sender.controller.actions.projectBin.place(bin.id, { trackId: track.id, timelineStartFrame: overlap ? 0 : 38_400 });
	const before = sender.controller.project; assert.ok(validateSoundscaperProject(before));
	assert.equal(before.clips.length, 2); assert.equal(before.sources.length, 1); assert.equal(before.projectBin.clips.length, 1);
	assert.deepEqual(before.clips.map(clip => [clip.sourceId, clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames]),
		[[bin.sourceId, 0, 0, 38_400], [bin.sourceId, overlap ? 0 : 38_400, 0, 38_400]]);
	const owner = before.tracks.find(candidate => candidate.id === track.id); assert.ok(owner?.type === 'audio');
	assert.deepEqual(new Set(owner.clipIds), new Set(before.clips.map(clip => clip.id)));
	assert.equal(sender.controller.getSnapshot().history.undoEntries.length, history + 1);
	await sender.controller.actions.edit.undo(); assert.deepEqual(sender.controller.project?.clips, placed.clips);
	await sender.controller.actions.edit.redo(); assert.deepEqual(sender.controller.project?.clips, before.clips);
	await sender.controller.actions.project.flush();
	const current = sender.controller.project; assert.ok(validateSoundscaperProject(current));
	assert.deepEqual(current.clips, before.clips); assert.deepEqual(current.tracks, before.tracks);
	assert.deepEqual(await sender.store.loadProject(current.id), current);
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(current, sender.store); assert.ok(archive.blob);
	const recipient = await controllerSession(context, options);
	await recipient.controller.actions.project.openScapeFile(new File([archive.blob], 'Bin.sscape'), () => 'copy');
	const restored = recipient.controller.project; assert.ok(validateSoundscaperProject(restored));
	assert.deepEqual(restored.clips, before.clips); assert.deepEqual(restored.tracks, before.tracks); assert.deepEqual(restored.projectBin, before.projectBin);
	assert.deepEqual(restored.sources, before.sources);
	const source = restored.sources[0]; assert.ok(source?.kind === 'audio'); assert.equal(source.frameCount, 38_400); assert.equal(source.channelCount, 2);
	const channels = await readCustodyPcm(recipient.store, source);
	assert.ok(channels[0]?.every(sample => sample === .125)); assert.ok(channels[1]?.every(sample => sample === -.25));
	await recipient.controller.actions.export.exportFcpxml();
	const output = saved[0]; assert.ok(output); assert.match(output.name, /\.fcpxml$/u);
	const timelines = readWithReference(await output.text(), 'fcpx_xml', {}, '.fcpxml');
	const tracks = timelines[0]?.tracks; assert.ok(tracks);
	const clips = tracks.flatMap(track => track.items).filter(item => item.schema === 'Clip'); assert.equal(clips.length, 2);
	assert.deepEqual(clips.map(clip => clip.startValue / clip.startRate), [0, 0]);
	assert.deepEqual(clips.map(clip => clip.durationValue / clip.durationRate), [.8, .8]);
	assert.equal(Math.max(...tracks.map(track => track.items.reduce((seconds, item) => seconds + item.durationValue / item.durationRate, 0))), overlap ? .8 : 1.6);
});
