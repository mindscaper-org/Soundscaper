/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationMenuProductItems as commonItems } from '../src/common/editor/ui/application-menu-product-items.js';
import { createApplicationMenuProductItems as soundscaperItems } from '../src/soundscaper/editor-application-menu-product-runtime.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createEffect } from '../src/common/editor/effects.js';

for (const factory of [commonItems, soundscaperItems]) test(`Freeze failures reach the workspace error handler through ${factory === commonItems ? 'common' : 'Soundscaper'} menus`, async () => {
	const project = createSoundscaperProject({ tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'], effects: [createEffect('delay')] }],
		sources: [{ id: 'source', sampleRate: 48000, channelCount: 1, frameCount: 4800 }], clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4800 }] });
	const errors: unknown[] = [], failure = new Error('Storage is full');
	const items = factory({ productId: 'soundscaper', project, copy: {}, editBlocked: false,
		capabilities: { audioTrackFreeze: true }, snapshot: { selectedTrackId: 'voice' }, actions: {
			run: async (operation: () => unknown) => { try { return await operation(); } catch (error) { errors.push(error); } },
			soundscaperWorkflow: { freezeActionsAvailable: true, freezeStatus: 'none', freeze: async () => { throw failure; } },
		} });
	const freeze = items.tracks.find(item => item?.id === 'soundscaper-freeze');
	const click = freeze?.items?.[0]?.onClick;
	assert.ok(click);
	await click();
	assert.deepEqual(errors, [failure]);
});
