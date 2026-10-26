/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audioBuffer, createController, createTwoTrackFixture, storedSample } from './helpers/audio-editor-multitrack-selection-harness.js';

test('Effect > Repeat Last ignores a deleted detector belonging to an unrelated draft', async () => {
	const input = new Float32Array(256).fill(0.25);
	const { store } = await createTwoTrackFixture('next-repeat-detector', new Map([['voice', input], ['detector', input]]), 48_000);
	const controller = createController(store, async (_project: unknown, range: { startFrame: number; endFrame: number }) =>
		audioBuffer([input.slice(range.startFrame, range.endFrame)], 48_000));
	try {
		await controller.ready;
		controller.actions.effects.setControlTrack('detector');
		controller.actions.timeline.selectTrack('voice');
		controller.actions.timeline.setSelection(0, input.length);
		await controller.actions.effects.applySelection({ type: 'audacity-invert', params: {} });
		controller.actions.track.remove('detector');
		const before = controller.getSnapshot().history.undoEntries.length;
		await controller.actions.effects.repeatLast();
		const snapshot = controller.getSnapshot();
		assert.equal(snapshot.history.undoEntries.length, before + 1);
		assert.ok(snapshot.project);
		const replacement = snapshot.project.clips.find(clip => 'sourceId' in clip && clip.sourceId !== 'voice-source');
		assert.ok(replacement && 'sourceId' in replacement && typeof replacement.sourceId === 'string');
		assert.equal(await storedSample(store, replacement.sourceId, 0), -0.25);
	} finally { await controller.dispose(); }
});
