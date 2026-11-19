/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { loopPointerPreview } from '../src/common/editor/ui/timeline/clip-loop-pointer.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { audioRenderCustody } from './helpers/audio-render-custody.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';

const PERIOD = 4_800;
const RATE = 48_000;

for (const [name, length, splitAt, originalPhase, reversedPhase] of [
	['partial split loop', 12_000, 650, 650, 2400],
	['split loop shorter than one period', 7800, 4600, 4600, 1800],
	['whole loop', 9600, 0, 0, 0],
	['legacy partial single pass', 2400, 0, 650, null],
	['ordinary clip', PERIOD, 0, null, null],
] as const) {
	test(`timeline Reverse plays the complete ${name} backwards through Undo and Redo`, async context => {
		const { controller, render, archive, store, open } = await audioRenderCustody(context);
		const path = await mkdtemp(join(tmpdir(), 'goal-loop-reverse.'));
		context.after(async () => { await rm(path, { recursive: true }); });
		const source = Float32Array.from({ length: PERIOD }, (_, frame) => 0.2 * Math.sin(2 * Math.PI * 440 * frame / RATE) * (frame + 1) / PERIOD);
		const wav = encodeWav([source], { sampleRate: RATE, float: true }); assert.ok(wav instanceof Uint8Array);
		const waveName = 'Asymmetric phrase.wav';
		await writeFile(join(path, waveName), wav);
		await controller.actions.project.importFiles([new File([Uint8Array.from(await readFile(join(path, waveName)))],
			waveName, { type: 'audio/wav' })], { destination: 'timeline' });
		const imported = resolveRuntimeProjectProjection(clipboardProject(controller.project));
		const [clip] = imported.clips; assert.ok(clip?.kind === 'audio');
		const trackId = controller.getSnapshot().selectedTrackId; assert.ok(trackId);
		// Keep native boundary smoothing out of the interior phase comparison.
		await controller.actions.clip.update(clip.id, { fadeInFrames: 0, fadeOutFrames: 0 });
		if (length > PERIOD) {
			const drag = loopPointerPreview({ kind: 'clip-loop', clipId: clip.id, trackId, startX: 0, original: clip },
				PERIOD, length - PERIOD, RATE, RATE);
			assert.ok(drag);
			await controller.actions.clip.update(clip.id, { loop: drag.loopChange });
		}
		if (name === 'legacy partial single pass') {
			const current = clipboardProject(controller.project);
			const [original] = current.clips; assert.ok(original?.kind === 'audio');
			const [asset] = current.sources; assert.ok(asset?.kind === 'audio');
			const sourceId = 'legacy-loop-audio';
			await open({
				...current, id: 'legacy-single-pass-reverse', sources: [{ ...asset, id: sourceId, storageKey: sourceId }],
				clips: [{ ...original, sourceId, durationFrames: length, opaqueExtensions: {
					'org.soundscaper.clip-loop/v1': { periodFrames: PERIOD, offsetFrames: originalPhase },
				} }],
			}, new Map([[sourceId, [source]]]));
		}
		if (splitAt) {
			await controller.actions.timeline.setExactSelection(splitAt, splitAt, { trackIds: [trackId] });
			controller.actions.transport.seek(splitAt);
			await controller.actions.edit.split(clip.id);
		}
		const before = clipboardProject(controller.project);
		const target = resolveRuntimeProjectProjection(before).clips.find(value => value.timelineStartFrame === splitAt);
		assert.ok(target?.kind === 'audio');
		assert.equal(target.durationFrames, length - splitAt);
		assert.equal(readClipLoop(target)?.offsetFrames ?? null, originalPhase);
		const forward = await render(length);
		const history = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.clip.reverse(target.id);
		const after = clipboardProject(controller.project), reversed = await render(length);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		assertReversedInterior(reversed, forward, splitAt, length);
		const reversedClip = after.clips.find(value => value.id === target.id); assert.ok(reversedClip?.kind === 'audio');
		assert.equal(reversedClip.reversed, true);
		assert.equal(readClipLoop(reversedClip)?.offsetFrames ?? null, reversedPhase);
		assert.deepEqual(after.sources, before.sources);
		assert.deepEqual(reversed.map(channel => channel.subarray(0, splitAt)), forward.map(channel => channel.subarray(0, splitAt)));
		await controller.actions.edit.undo();
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		assertPcmChannelsEqual(await render(length), forward, 'Undo PCM');
		await controller.actions.edit.redo();
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
		assertPcmChannelsEqual(await render(length), reversed, 'Redo PCM');
		if (name === 'partial split loop') {
			await controller.actions.project.flush();
			const saved = await archive.exportScapeProject(clipboardProject(controller.project), store);
			assert.ok(saved.blob);
			const scape = join(path, 'Reversed phrase.sscape');
			await writeFile(scape, new Uint8Array(await saved.blob.arrayBuffer()));
			const recipient = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
			try {
				const reopened = await archive.importScapeProject(new Blob([Uint8Array.from(await readFile(scape))]), recipient);
				assert.equal(reopened.readOnly, false);
				assert.deepEqual(clipboardDocument(clipboardProject(reopened.project)), clipboardDocument(after));
				const [storedSource] = after.sources; assert.ok(storedSource?.kind === 'audio');
				assertPcmChannelsEqual(await readCustodyPcm(recipient, storedSource), [source], 'reopened immutable PCM');
			} finally { await recipient.close(); }
		}
	});
}

function assertReversedInterior(actual: readonly Float32Array[], forward: readonly Float32Array[], start: number, end: number) {
	for (const [channel, pcm] of actual.entries()) {
		const original = forward[channel]!;
		for (let frame = start + 256; frame < end - 256; frame++) {
			assert.ok(Math.abs(pcm[frame]! - original[end - 1 - (frame - start)]!) < 1e-6,
				`channel ${channel}, reversed sample ${frame}`);
		}
	}
}
