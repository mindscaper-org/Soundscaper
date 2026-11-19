/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { canJoinClips } from '../src/common/editor/commands/clip-link-runtime.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

function project() {
	return createCurrentAudioEditorProject({
		sources: [{ id: 'source', storageKey: 'source', name: 'Source', frameCount: 200, channelCount: 1, sampleRate: 48_000 }],
		clips: ['left', 'right'].map((id, index) => ({ id, sourceId: 'source', timelineStartFrame: index * 100,
			sourceStartFrame: index * 100, sourceDurationFrames: 100, durationFrames: 100 })),
		tracks: [{ id: 'track', name: 'Track', clipIds: ['left', 'right'] }],
	});
}

test('Join refuses to discard different clip rack processing or bypass', () => {
	for (const variant of ['missing', 'parameters', 'enabled', 'rack-bypass'] as const) {
		let document = applyEditorCommand(project(), { type: 'effect/add', scope: 'clip', trackId: 'left',
			effect: createEffect('delay', { id: 'left-delay', params: { time: 0.1 } }) });
		if (variant !== 'missing') document = applyEditorCommand(document, { type: 'effect/add', scope: 'clip', trackId: 'right',
			effect: createEffect('delay', { id: 'right-delay', params: { time: variant === 'parameters' ? 0.2 : 0.1 },
				...(variant === 'enabled' ? { enabled: false } : {}),
				}) });
		if (variant === 'rack-bypass') document = applyEditorCommand(document, { type: 'clip/update', clipId: 'right', changes: { effectsActive: false } });
		assert.equal(canJoinClips(document, ['left', 'right']), false, variant);
		assert.throws(() => applyEditorCommand(document, { type: 'clip/join', clipIds: ['left', 'right'] }), /processing|render/iu, variant);
		assert.equal(document.clips.length, 2);
	}
});

test('Join retains equivalent clip processing while ignoring per-clip effect identities', () => {
	let document = project();
	for (const id of ['left', 'right']) document = applyEditorCommand(document, { type: 'effect/add', scope: 'clip', trackId: id,
		effect: createEffect('delay', { id: `${id}-delay`, params: { time: 0.1 } }) });
	assert.equal(canJoinClips(document, ['left', 'right']), true);
	const joined = applyEditorCommand(document, { type: 'clip/join', clipIds: ['left', 'right'] });
	assert.equal(joined.clips.length, 1);
	assert.equal(joined.clips[0]?.durationFrames, 200);
	assert.equal(joined.clips[0]?.effects?.[0]?.params.time, 0.1);
});
