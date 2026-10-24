/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { bindFramescaperSelectedImageAuthoringControllerTimelineImage as bind, framescaperSelectedImageImportResultTimelineImageFor as resultFor } from '../src/framescaper/editor-selected-timeline-image-image-authoring-controller.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

function fixture() {
	const initial = createFramescaperProject(PROFILE, { id: 'outgoing' }); let project = initial, selected = 0, generation = 0;
	let finish = (): void => {}, reject = (_reason: Error): void => {}, entered = (): void => {};
	const held = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
	const reading = new Promise<void>(resolve => { entered = resolve; });
	const signals: (AbortSignal | undefined)[] = [], imported: string[] = [], listeners = new Set<() => void>();
	const controller = { get project() { return project; }, captureProjectGeneration: () => ({ generation, projectId: project.id }),
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, getTelemetrySnapshot: () => ({ positionFrame: 0 }),
		actions: { project: { flush: () => undefined, openById: () => undefined } } };
	bind({ controller, selectFiles: async () => [new File([Uint8Array.of(++selected)], `image-${selected}.png`, { type: 'image/png' })],
		session: { captureProjectHistory: () => { throw new Error('No publication expected.'); }, assertProjectHistoryToken: () => undefined,
			updateProjectHistory: () => undefined, markProjectSaved: () => undefined, getProjectHistory: () => { throw new Error('No publication expected.'); } },
		executeCommand: history => history, publishIfCurrent: async () => null,
		importImages: async request => {
			signals.push(request.signal);
			if (request.files[0]!.name === 'image-1.png') { entered(); await held; }
			request.signal?.throwIfAborted(); request.assertCurrent?.(); imported.push(request.project.id);
			return { project: request.project, files: [] };
		},
	});
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(runtime);
	return { controller, runtime, reading, signals, imported, initial, finish, reject,
		setProject(value: typeof initial, activate = true) { project = value; if (activate) generation++; for (const listener of listeners) listener(); }, get selected() { return selected; }, get subscriptions() { return listeners.size; } };
}
const turn = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

for (const late of ['success', 'failure'] as const) test(`a fresh project image request bypasses a retired native read with late ${late}`, async () => {
	const current = fixture();
	const old = current.runtime.run('video-still').then(() => null, (error: unknown) => error); await current.reading;
	current.setProject(createFramescaperProject(PROFILE, { id: 'incoming' })); const fresh = current.runtime.run('video-still');
	try {
		await turn(); assert.equal(current.selected, 2, 'The new owner must open its chooser while the old read is held.');
		await fresh; assert.deepEqual(current.imported, ['incoming']);
		const signal = current.signals[0]; assert.ok(signal); assert.equal(await old, signal.reason);
		assert.equal(getEventListeners(signal, 'abort').length, 0); assert.equal(current.subscriptions, 0);
		const result = resultFor(current.controller); assert.equal(result?.project.id, 'incoming');
		if (late === 'success') current.finish(); else current.reject(new Error('Late native read failed.'));
		await turn(); assert.equal(resultFor(current.controller), result); assert.deepEqual(current.imported, ['incoming']);
	} finally { current.finish(); await Promise.allSettled([old, fresh]); }
});

test('same-project image requests retain FIFO order', async () => {
	const current = fixture(), old = current.runtime.run('video-still'); await current.reading;
	const fresh = current.runtime.run('video-still'); await turn(); assert.equal(current.selected, 1);
	current.finish(); await Promise.all([old, fresh]); assert.equal(current.selected, 2);
	assert.deepEqual(current.imported, ['outgoing', 'outgoing']);
});

test('A to B to A image requests never revive the retired A generation', async () => {
	const current = fixture(), old = current.runtime.run('video-still').then(() => null, (error: unknown) => error); await current.reading;
	current.setProject(createFramescaperProject(PROFILE, { id: 'incoming' })); const middle = current.runtime.run('video-still');
	try {
		await turn(); assert.equal(current.selected, 2); await middle;
		current.setProject(current.initial); await current.runtime.run('video-still');
		const latest = resultFor(current.controller); current.finish(); await turn();
		assert.ok(current.signals[0]?.aborted); assert.equal(await old, current.signals[0].reason);
		assert.equal(resultFor(current.controller), latest); assert.deepEqual(current.imported, ['incoming', 'outgoing']);
	} finally { current.finish(); await Promise.allSettled([old, middle]); }
});


test('returning to A without a B image request retires the old A activation', async () => {
	const current = fixture(), old = current.runtime.run('video-still').then(() => null, (error: unknown) => error); await current.reading;
	current.setProject(createFramescaperProject(PROFILE, { id: 'incoming' })); current.setProject(current.initial);
	const fresh = current.runtime.run('video-still');
	try {
		await turn(); assert.equal(current.selected, 2); await fresh;
		assert.equal(await old, current.signals[0]?.reason); assert.ok(current.signals[0]?.aborted);
		current.finish(); await turn(); assert.deepEqual(current.imported, ['outgoing']);
	} finally { current.finish(); await Promise.allSettled([old, fresh]); }
});

test('ordinary document edits do not reset the same activation FIFO', async () => {
	const current = fixture(), old = current.runtime.run('video-still'); await current.reading;
	current.setProject(createFramescaperProject(PROFILE, { id: 'outgoing' }), false);
	const fresh = current.runtime.run('video-still'); await turn(); assert.equal(current.selected, 1);
	current.finish(); await Promise.all([old, fresh]); assert.deepEqual(current.imported, ['outgoing', 'outgoing']);
});
