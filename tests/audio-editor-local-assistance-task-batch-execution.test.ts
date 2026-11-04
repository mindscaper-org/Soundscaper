/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeLocalAssistanceTaskBatch } from '../src/common/editor/ui/local-assistance-task-batch-execution.ts';
import { INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT,
	type LocalAssistanceGuidedSessionStore } from '../src/common/editor/ui/local-assistance-guided-session-store.ts';
import type { LocalAssistanceSelectedMediaPreparationPort } from '../src/common/editor/assistance/local-assistance-preparation.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';

function fixture(failureIndex = -1) {
	const calls: string[] = [];
	const phases: string[] = [];
	const preparations = [0, 1].map(() => ({} as LocalAssistanceSelectedMediaPreparationPort));
	const batch = { preparations, commit: async () => { calls.push('commit'); },
		dispose: async () => { calls.push('rollback-or-release'); } };
	let next = 0;
	const createSession = (): LocalAssistanceGuidedSessionStore => {
		const index = next++;
		let snapshot = INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT;
		const listeners = new Set<() => void>();
		const update = (change: object) => { snapshot = { ...snapshot, ...change }; listeners.forEach((fn) => fn()); };
		return {
			getSnapshot: () => snapshot,
			subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
			selectWorkflow: () => undefined, setSettings: () => undefined,
			run: async () => { calls.push(`run:${index}`); update({ phase: index === failureIndex ? 'cancelled' : 'completed',
				canReview: index !== failureIndex }); },
			review: async () => { update({ phase: 'review-ready', review: { choices: [{ id: 'audio', enabled: true }] } }); },
			setReviewChoiceSelected: () => { update({ canAccept: true }); },
			accept: async () => { calls.push(`stage:${index}`); update({ phase: 'accepted' }); },
			dispose: async () => { calls.push(`dispose:${index}`); },
		} as unknown as LocalAssistanceGuidedSessionStore;
	};
	return { calls, phases, batch, createSession };
}

test('multiple effects stage each validated selection and publish one atomic batch', async () => {
	const f = fixture();
	const result = await executeLocalAssistanceTaskBatch({ ...f, bridge: null,
		workflowId: 'enhance-dialogue', settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		signal: new AbortController().signal, onSnapshot: snapshot => { f.phases.push(snapshot.phase); } });
	assert.equal(result.phase, 'accepted');
	assert.deepEqual(f.calls, ['run:0', 'stage:0', 'dispose:0', 'run:1', 'stage:1', 'dispose:1', 'commit', 'rollback-or-release']);
	assert.ok(!f.phases.includes('accepted'), 'a staged child must not close the task before publication');
});

test('a canceled selection rolls back earlier staged audio without a partial document edit', async () => {
	const f = fixture(1);
	const result = await executeLocalAssistanceTaskBatch({ ...f, bridge: null,
		workflowId: 'enhance-dialogue', settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		signal: new AbortController().signal, onSnapshot: () => undefined });
	assert.equal(result.phase, 'cancelled');
	assert.ok(!f.calls.includes('commit'));
	assert.equal(f.calls.at(-1), 'rollback-or-release');
});

test('aborting before execution releases batch custody and runs no child', async () => {
	const f = fixture();
	const controller = new AbortController(); controller.abort();
	await assert.rejects(executeLocalAssistanceTaskBatch({ ...f, bridge: null,
		workflowId: 'enhance-dialogue', settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		signal: controller.signal, onSnapshot: () => undefined }), { name: 'AbortError' });
	assert.deepEqual(f.calls, ['rollback-or-release']);
});

test('canceling during source publication immediately discards the batch', async () => {
	const f = fixture();
	const controller = new AbortController();
	let enter!: () => void;
	let release!: () => void;
	const entered = new Promise<void>(resolve => { enter = resolve; });
	const blocked = new Promise<void>(resolve => { release = resolve; });
	const result = executeLocalAssistanceTaskBatch({ ...f, bridge: null,
		workflowId: 'enhance-dialogue', settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		signal: controller.signal, onSnapshot: () => undefined,
		createSession: () => {
			const session = f.createSession();
			return { ...session, accept: async () => { enter(); await blocked; await session.accept(); } };
		} });
	await entered;
	controller.abort();
	assert.ok(f.calls.includes('rollback-or-release'), 'Cancel must stop storage before acceptance finishes');
	release();
	await assert.rejects(result, { name: 'AbortError' });
	assert.ok(!f.calls.includes('commit'));
});

test('native output custody release failure prevents document publication', async () => {
	const f = fixture();
	const result = await executeLocalAssistanceTaskBatch({ ...f, bridge: null,
		workflowId: 'enhance-dialogue', settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		signal: new AbortController().signal, onSnapshot: () => undefined,
		createSession: () => {
			const session = f.createSession();
			return { ...session, getSnapshot: () => {
				const snapshot = session.getSnapshot();
				return { ...snapshot, error: snapshot.phase === 'accepted' ? 'Native custody release failed.' : null };
			} };
		} });
	assert.equal(result.phase, 'error');
	assert.match(result.error!, /custody release failed/);
	assert.ok(!f.calls.includes('commit'));
	assert.ok(!f.calls.includes('run:1'));
	assert.equal(f.calls.at(-1), 'rollback-or-release');
});
