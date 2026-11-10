/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { clipboardDocument, clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

test('ordinary source Normalize publishes independently expected CPU PCM through controller history, storage and fresh Scape', async context => {
	const f = await createClipboardCustody(context), { controller } = f;
	const input = Float32Array.from({ length: 48_000 }, (_value, frame) => .125 * Math.sin(2 * Math.PI * 500 * frame / 48_000));
	const encoded = encodeWav([input], { sampleRate: 48_000, float: true }); assert.ok(encoded instanceof Uint8Array);
	await controller.actions.project.importFiles([new File([Uint8Array.from(encoded)], 'Quiet float.wav', { type: 'audio/wav' })], { destination: 'timeline' });
	const before = clipboardProject(controller.project), original = before.sources[0], selected = before.clips[0];
	assert.ok(original?.kind === 'audio' && selected?.kind === 'audio');
	assert.deepEqual([original.sampleRate, original.frameCount, original.channelCount], [48_000, 48_000, 1]);
	await f.archive((_name, channels) => assertPcmChannelsEqual(channels, [input]));
	controller.actions.effects.setSourceSelection({ clipId: selected.id, startFrame: 0, endFrame: 48_000 });
	const entries = controller.getSnapshot().history.undoEntries.length;
	await controller.actions.effects.applySelection({ type: 'audacity-normalize', params: {} });
	const edited = clipboardProject(controller.project), clip = edited.clips[0]; assert.ok(clip?.kind === 'audio');
	assert.equal(controller.getSnapshot().status.state, 'success');
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	assert.notEqual(clip.sourceId, original.id);
	assert.deepEqual([clip.timelineStartFrame, clip.sourceStartFrame, clip.sourceDurationFrames, clip.durationFrames, clip.gain], [0, 0, 48_000, 48_000, 1]);
	const derived = edited.sources.find(source => source.id === clip.sourceId); assert.ok(derived?.kind === 'audio');
	assert.notEqual(derived.name, original.name);
	assert.deepEqual([derived.sampleRate, derived.frameCount, derived.channelCount], [48_000, 48_000, 1]);
	assert.equal(edited.sources.length, 1); assert.equal(edited.sources[0]?.id, derived.id);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await f.archive((_name, channels) => assertPcmChannelsEqual(channels, [input]));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await f.archive((name, channels) => {
		if (name === original.name) assertPcmChannelsEqual(channels, [input]);
		else {
			assert.equal(name, derived.name); assert.equal(channels.length, 1); assert.equal(channels[0]?.length, 48_000);
			// The source is a zero-centred 500 Hz sine. Normalize's -1 dBFS target
			// therefore has this independent closed form;
			// allow only the single-precision arithmetic of the shipping CPU effect.
			const target = 10 ** (-1 / 20); let maximumError = 0;
			for (let frame = 0; frame < 48_000; frame++) maximumError = Math.max(maximumError,
				Math.abs(channels[0]![frame]! - target * Math.sin(2 * Math.PI * 500 * frame / 48_000)));
			assert.ok(maximumError < 1e-6, `independent Normalize PCM error ${maximumError}`);
		}
	});
});
