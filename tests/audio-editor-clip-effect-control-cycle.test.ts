/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

function project() {
	return createCurrentAudioEditorProject({
		sources: [{ id: 'source', name: 'Source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 }],
		tracks: ['music', 'voice', 'cue'].map(id => ({ id, clipIds: [`${id}-clip`] })),
		clips: ['music', 'voice', 'cue'].map(id => ({ id: `${id}-clip`, sourceId: 'source', durationFrames: 48_000 })),
	});
}

function duck(trackId: string, controlTrackId: string) {
	return { type: 'effect/add' as const, scope: 'clip' as const, trackId: `${trackId}-clip`,
		effect: createEffect('audacity-auto-duck', { id: `${trackId}-duck`, context: { controlTrackId } }) };
}

test('adding two clip Auto Ducks cannot feed their processed inputs back into each other', () => {
	const document = applyEditorCommand(project(), duck('music', 'voice'));
	assert.throws(() => applyEditorCommand(document, duck('voice', 'music')), /control track|cycle/iu);
	assert.doesNotThrow(() => applyEditorCommand(document, duck('voice', 'cue')));
});

test('changing a clip detector or moving its clip cannot introduce a control cycle', () => {
	let document = applyEditorCommand(project(), duck('music', 'voice'));
	document = applyEditorCommand(document, duck('voice', 'cue'));
	assert.throws(() => applyEditorCommand(document, { type: 'effect/update', scope: 'clip', trackId: 'voice-clip',
		effectId: 'voice-duck', changes: { context: { controlTrackId: 'music' } } }), /control track|cycle/iu);
	assert.throws(() => applyEditorCommand(document, { type: 'clip/move', clipId: 'music-clip', trackId: 'voice', timelineStartFrame: 0 }), /control track|cycle/iu);
});

test('re-enabling a bypassed clip rack cannot close a detector feedback loop', () => {
	let document = applyEditorCommand(project(), { type: 'clip/update', clipId: 'music-clip', changes: { effectsActive: false } });
	document = applyEditorCommand(document, duck('music', 'voice'));
	document = applyEditorCommand(document, duck('voice', 'music'));
	assert.throws(() => applyEditorCommand(document, { type: 'clip/update', clipId: 'music-clip', changes: { effectsActive: true } }), /control track|cycle/iu);
});
