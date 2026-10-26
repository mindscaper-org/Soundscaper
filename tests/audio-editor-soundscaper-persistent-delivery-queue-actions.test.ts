/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { DeliveryBatch, DeliveryBatchMember } from '../src/common/editor/delivery-batch.ts';
import {
	createSoundscaperPersistentDeliveryControllerComposition,
	type SoundscaperPersistentDeliveryControllerRuntime,
} from '../src/common/editor/controller/export/soundscaper-persistent-delivery-controller-composition.ts';
import type {
	SoundscaperPersistentDeliveryEnqueueRequest,
	SoundscaperPersistentDeliveryRendererBridge,
	SoundscaperPersistentDeliverySummary,
} from '../src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-ui-service.ts';

const IDENTITY = Object.freeze({
	projectId: 'album', projectRevision: 4, projectSha256: 'ab'.repeat(32),
});
const GRANT_ID = 'cd'.repeat(24);
const SETTINGS = Object.freeze({ format: 'flac', mode: 'mix', range: 'project' });
const EXPORT_PLAN = Object.freeze({ format: 'flac', outputFrames: 48_000, version: 1 });

test('enqueue returns the admitted jobs and wakes the worker with the exact derived batch authority', async (t) => {
	const fixture = queueFixture([]);
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	t.after(() => composition.dispose());
	await composition.ready;
	await composition.queue.selectDestination();

	assert.deepEqual(await composition.queue.enqueueBatch(batch()), ['11'.repeat(24)]);
	assert.equal(fixture.enqueues.length, 1);
	const admission = fixture.enqueues[0]!;
	assert.deepEqual(admission.admission.projectIdentity, IDENTITY);
	assert.deepEqual(admission.admission.planFingerprints,
		admission.items.map(({ description }) => description.planFingerprint));
	assert.equal(admission.items[0]!.description.destinationGrantId, GRANT_ID);
	assert.deepEqual(JSON.parse(admission.items[0]!.description.planPayload), {
		kind: 'soundscaper-persistent-audio-delivery-plan', version: 1,
		executor: 'ordinary-audio-export-v1',
		settings: SETTINGS, exportPlan: EXPORT_PLAN,
		batch: {
			batchId: 'masters', memberId: 'flac', presetId: 'preset-flac',
			target: { kind: 'project' }, mode: 'mix',
		},
	});
	assert.deepEqual(composition.queue.list().entries.map(({ jobId }) => jobId), ['11'.repeat(24)]);
	assert.deepEqual(fixture.claims, [{
		jobId: '11'.repeat(24), currentAuthority: {
			projectIdentity: IDENTITY,
			planFingerprint: admission.items[0]!.description.planFingerprint,
		},
	}]);
});

test('retry publishes the queued state and wakes the worker for the requested job', async (t) => {
	const failed = entry('22'.repeat(24), 'failed');
	const fixture = queueFixture([failed]);
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	t.after(() => composition.dispose());
	await composition.ready;
	assert.equal(fixture.claims.length, 0);

	await composition.queue.retry(failed.jobId);
	assert.deepEqual(fixture.controls, [['retry', { jobId: failed.jobId }]]);
	assert.equal(composition.queue.list().entries[0]!.state, 'queued');
	assert.deepEqual(fixture.claims.map(({ jobId }) => jobId), [failed.jobId]);
});

test('batch retry returns and wakes only failed members of that batch', async (t) => {
	const failed = entry('22'.repeat(24), 'failed');
	const completed = entry('33'.repeat(24), 'completed');
	const cancelled = entry('44'.repeat(24), 'cancelled');
	const unrelated = { ...entry('55'.repeat(24), 'failed'), batchId: 'other-batch' };
	const fixture = queueFixture([failed, completed, cancelled, unrelated]);
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	t.after(() => composition.dispose());
	await composition.ready;

	assert.deepEqual(await composition.queue.retryBatchFailures('masters'), [failed.jobId]);
	assert.deepEqual(fixture.controls, [['retry', { jobId: failed.jobId }]]);
	assert.deepEqual(composition.queue.list().entries.map(({ state }) => state), [
		'queued', 'completed', 'cancelled', 'failed',
	]);
	assert.deepEqual(fixture.claims.map(({ jobId }) => jobId), [failed.jobId]);
});

test('reauthorizing a destination returns the grant and restarts its waiting jobs', async (t) => {
	const waiting = entry('66'.repeat(24), 'needs-authorization');
	const fixture = queueFixture([waiting]);
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	t.after(() => composition.dispose());
	await composition.ready;

	assert.deepEqual(await composition.queue.reauthorizeDestination(GRANT_ID), { grantId: GRANT_ID });
	assert.deepEqual(fixture.controls, [['reauthorizeDestination', { grantId: GRANT_ID }]]);
	assert.equal(composition.queue.list().entries[0]!.state, 'queued');
	assert.deepEqual(fixture.claims.map(({ jobId }) => jobId), [waiting.jobId]);
});

test('a rejected retry preserves its failure and does not wake the worker', async (t) => {
	const failed = entry('22'.repeat(24), 'failed');
	const fixture = queueFixture([failed]);
	const failure = new Error('The queue could not persist the retry.');
	fixture.runtime.bridge!.retry = async () => { throw failure; };
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	t.after(() => composition.dispose());
	await composition.ready;
	const readsBefore = fixture.listReads();

	await assert.rejects(composition.queue.retry(failed.jobId), (error) => error === failure);
	assert.equal(fixture.listReads(), readsBefore);
	assert.equal(composition.queue.list().entries[0]!.state, 'failed');
	assert.deepEqual(fixture.claims, []);
});

function queueFixture(initialEntries: readonly SoundscaperPersistentDeliverySummary[]) {
	let entries = [...initialEntries];
	let reads = 0;
	const controls: Array<readonly [string, unknown]> = [];
	const enqueues: SoundscaperPersistentDeliveryEnqueueRequest[] = [];
	const claims: Array<Readonly<{
		jobId: string; currentAuthority: Readonly<{ projectIdentity: unknown; planFingerprint: string }>;
	}>> = [];
	const bridge: SoundscaperPersistentDeliveryRendererBridge & Record<string, unknown> = {
		selectDestination: async () => ({ grantId: GRANT_ID }),
		reauthorizeDestination: async (request) => {
			controls.push(['reauthorizeDestination', request]);
			entries = entries.map((row) => row.destinationGrantId === request.grantId
				&& row.state === 'needs-authorization' ? { ...row, state: 'queued' } : row);
			return { grantId: request.grantId };
		},
		currentProjectIdentity: async ({ projectId }) => projectId === null ? null : IDENTITY,
		enqueueBatch: async (request) => {
			enqueues.push(request);
			const admitted = request.items.map(({ description, batch: admittedBatch }) => ({
				...entry('11'.repeat(24), 'queued'),
				planFingerprint: description.planFingerprint,
				batchId: admittedBatch.batchId, batchMember: admittedBatch.member,
			}));
			entries.push(...admitted);
			return admitted;
		},
		list: async () => {
			reads += 1;
			return { entries, paused: false, nextCursor: null };
		},
		events: async () => ({ events: [], nextSequence: 0, hasMore: false }),
		pause: async () => undefined,
		resume: async () => undefined,
		reorder: async () => undefined,
		cancel: async () => undefined,
		retry: async (request) => {
			controls.push(['retry', request]);
			entries = entries.map((row) => row.jobId === request.jobId ? { ...row, state: 'queued' } : row);
		},
	};
	const runtime: SoundscaperPersistentDeliveryControllerRuntime = {
		productId: 'soundscaper', bridge,
		getProject: () => ({ id: IDENTITY.projectId, revision: IDENTITY.projectRevision, title: 'Album' }),
		getSaveState: () => 'saved',
		captureProjectGeneration: () => ({ generation: 1, projectId: IDENTITY.projectId }),
		assertProjectGeneration: () => undefined,
		deliveryReport: () => null,
		workerTransport: { claimNext: async (request) => { claims.push(request); return null; } },
		exportService: {
			persistentAudioDeliveryAvailable: () => true,
			whenPersistentAudioDeliveryAvailable: async () => undefined,
			derivePersistentAudioDeliveryPlan: async () => ({ settings: SETTINGS, exportPlan: EXPORT_PLAN }),
			executePersistentAudioDeliveryPlan: async () => assert.fail('An unclaimed job must never render.'),
		},
	};
	return { runtime, controls, enqueues, claims, listReads: () => reads };
}

function batch(): DeliveryBatch {
	return { batchId: 'masters', members: [member('flac')] };
}

function member(memberId: string): DeliveryBatchMember {
	return {
		memberId, label: `Master ${memberId}`, presetId: 'preset-flac',
		target: { kind: 'project' }, mode: 'mix', settings: SETTINGS,
	};
}

function entry(
	jobId: string,
	state: SoundscaperPersistentDeliverySummary['state'],
): SoundscaperPersistentDeliverySummary {
	return {
		jobId, state, label: 'Master', attempt: 1, progress: null,
		lastFailureCode: state === 'failed' ? 'encode-failed' : null,
		projectIdentity: IDENTITY, planFingerprint: '12'.repeat(32), destinationGrantId: GRANT_ID,
		batchId: 'masters', batchMember: member(jobId), report: null, result: null,
	};
}
