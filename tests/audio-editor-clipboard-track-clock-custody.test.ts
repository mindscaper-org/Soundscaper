/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { clipboardDocument, clipboardPcm, clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

for (const action of ['paste', 'import', 'generate'] as const) test(`${action} publishes exact lower-rate track geometry and PCM through history and native Scape`, async context => {
	const fixture = await createClipboardCustody(context);
	const { controller } = fixture;
	const pcm = [clipboardPcm(action === 'paste' ? 48_000 : 24_000)];
	if (action === 'paste') {
		const source = createAudioSource({ id: 'recording', name: 'Recording.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const donor = createSoundscaperProject({ id: 'clipboard-source-48k', sources: [source],
			clips: [createAudioClip({ id: 'phrase', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['phrase'] })] });
		await fixture.open(donor, new Map([[source.id, pcm]]));
		await controller.actions.timeline.selectClip('phrase'); await controller.actions.edit.copy();
	}
	await fixture.open(createSoundscaperProject({ id: `destination-${action}`, sampleRate: 24_000 }), new Map());
	const baseline = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
	if (action === 'paste') await controller.actions.edit.paste();
	else if (action === 'import') {
		const bytes = encodeWav(pcm, { sampleRate: 24_000, float: true }); assert.ok(bytes instanceof Uint8Array);
		await controller.actions.project.importFiles([new File([Uint8Array.from(bytes)], 'Recording.wav', { type: 'audio/wav' })], { destination: 'timeline' });
	} else await controller.actions.generators.generate('tone', { durationSeconds: 30, frequency: 440, amplitude: .8, waveform: 'sine', channelCount: 1 });
	const edited = clipboardProject(controller.project);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	assert.equal(edited.sampleRate, 24_000); assert.equal(edited.tracks.length, 1); assert.equal(edited.clips.length, 1); assert.equal(edited.sources.length, 1);
	const clip = edited.clips[0], source = edited.sources[0], track = edited.tracks[0];
	assert.ok(clip?.kind === 'audio' && source?.kind === 'audio' && track);
	assert.deepEqual([clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.sourceDurationFrames],
		[0, 0, action === 'generate' ? 720_000 : 24_000, action === 'generate' ? 720_000 : pcm[0]!.length]);
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount],
		[action === 'paste' ? 48_000 : 24_000, action === 'generate' ? 720_000 : pcm[0]!.length, 1]);
	assert.equal(clip.sourceId, source.id); assert.deepEqual(track.clipIds, [clip.id]);
	assert.ok(track.spectrogram && typeof track.spectrogram === 'object' && 'maximumFrequency' in track.spectrogram);
	assert.equal(track.spectrogram.maximumFrequency, 12_000);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(baseline));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	const reopened = await fixture.archive((_name, channels) => {
		if (action !== 'generate') assertPcmChannelsEqual(channels, pcm);
		else {
			assert.equal(channels.length, 1); assert.equal(channels[0]?.length, 720_000);
			let maximumError = 0;
			for (let frame = 0; frame < 720_000; frame++) maximumError = Math.max(maximumError,
				Math.abs(channels[0]![frame]! - .8 * Math.sin(2 * Math.PI * 440 * frame / 24_000)));
			assert.ok(maximumError < 1e-6, `independent default Tone PCM error ${maximumError}`);
		}
	});
	assert.deepEqual(clipboardDocument(reopened), clipboardDocument(edited));
});
