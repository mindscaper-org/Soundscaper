/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { executeLocalAssistanceTask } from
	'../src/common/editor/ui/local-assistance-task-execution.ts';
import type { LocalAssistanceGuidedSessionStore } from
	'../src/common/editor/ui/local-assistance-guided-session-store.ts';

function fixture(options: { cancelled?: boolean; invalid?: boolean; acceptanceError?: boolean } = {}) {
	const calls: string[] = [];
	let phase = 'ready';
	const choices = [{ id: 'enhanced-audio', enabled: !options.invalid },
		{ id: 'unavailable-output', enabled: false }];
	const store = {
		getSnapshot: () => ({ phase, canReview: phase === 'completed',
			canAccept: phase === 'review-ready' && calls.includes('select:enhanced-audio'),
			review: phase === 'review-ready' ? { choices } : null }),
		run: async () => { calls.push('run'); phase = options.cancelled ? 'cancelled' : 'completed'; },
		review: async () => { calls.push('review'); phase = 'review-ready'; },
		setReviewChoiceSelected: (id: string, selected: boolean) => {
			assert.equal(selected, true); calls.push(`select:${id}`);
		},
		accept: async () => {
			calls.push('accept'); phase = options.acceptanceError ? 'review-ready' : 'accepted';
		},
	} as unknown as LocalAssistanceGuidedSessionStore;
	return { store, calls };
}

test('an ordinary audio effect validates its result and applies enabled output in one invocation', async () => {
	for (const workflowId of ['enhance-dialogue', 'reduce-reverb', 'separate-dialogue-music-effects'] as const) {
		const { store, calls } = fixture();
		await executeLocalAssistanceTask(store, workflowId);
		assert.deepEqual(calls, ['run', 'review', 'select:enhanced-audio', 'accept']);
		assert.equal(store.getSnapshot().phase, 'accepted');
	}
});

test('cancellation and invalid output never publish an effect result', async () => {
	const cancelled = fixture({ cancelled: true });
	await executeLocalAssistanceTask(cancelled.store, 'enhance-dialogue');
	assert.deepEqual(cancelled.calls, ['run']);
	const invalid = fixture({ invalid: true });
	await assert.rejects(executeLocalAssistanceTask(invalid.store, 'enhance-dialogue'), /no applicable audio/);
	assert.deepEqual(invalid.calls, ['run', 'review']);
});

test('tasks requiring result choices retain their review and acceptance steps', async () => {
	for (const workflowId of ['clean-filler-silence', 'reframe', 'make-highlights', 'transcribe-captions'] as const) {
		const { store, calls } = fixture();
		await executeLocalAssistanceTask(store, workflowId);
		assert.deepEqual(calls, ['run']);
	}
});

test('failed publication is not reported as accepted', async () => {
	const { store, calls } = fixture({ acceptanceError: true });
	await executeLocalAssistanceTask(store, 'enhance-dialogue');
	assert.deepEqual(calls, ['run', 'review', 'select:enhanced-audio', 'accept']);
	assert.equal(store.getSnapshot().phase, 'review-ready');
});
