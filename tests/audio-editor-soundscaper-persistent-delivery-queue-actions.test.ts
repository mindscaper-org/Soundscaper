/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { DeliveryBatch, DeliveryBatchMember } from '../src/common/editor/delivery-batch.ts';
import {
	createSoundscaperPersistentDeliveryUiService,
	type SoundscaperPersistentDeliveryEnqueueRequest,
	type SoundscaperPersistentDeliveryRendererBridge,
	type SoundscaperPersistentDeliverySummary,
} from '../src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-ui-service.ts';

const IDENTITY = Object.freeze({
	projectId: 'album', projectRevision: 4, projectSha256: 'ab'.repeat(32),
});
const GRANT_ID = 'cd'.repeat(24);
const SETTINGS = Object.freeze({ format: 'flac', mode: 'mix', range: 'project' });
const EXPORT_PLAN = Object.freeze({ format: 'flac', outputFrames: 48_000, version: 1 });

test('enqueue returns the admitted jobs with the exact derived batch authority', async () => {
	const fixture = queueFixture([]);
	await fixture.queue.refresh();
	await fixture.queue.selectDestination();

	assert.deepEqual(await fixture.queue.enqueueBatch(batch()), ['11'.repeat(24)]);
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
	assert.deepEqual(fixture.queue.list().entries.map(({ jobId }) => jobId), ['11'.repeat(24)]);
});

test('retry publishes the queued state for the requested job', async () => {
	const failed = entry('22'.repeat(24), 'failed');
	const fixture = queueFixture([failed]);
	await fixture.queue.refresh();

	await fixture.queue.retry(failed.jobId);
	assert.deepEqual(fixture.controls, [['retry', { jobId: failed.jobId }]]);
	assert.equal(fixture.queue.list().entries[0]!.state, 'queued');
});

test('batch retry queues and returns only failed members of that batch', async () => {
	const failed = entry('22'.repeat(24), 'failed');
	const completed = entry('33'.repeat(24), 'completed');
	const cancelled = entry('44'.repeat(24), 'cancelled');
	const unrelated = { ...entry('55'.repeat(24), 'failed'), batchId: 'other-batch' };
	const fixture = queueFixture([failed, completed, cancelled, unrelated]);
	await fixture.queue.refresh();

	assert.deepEqual(await fixture.queue.retryBatchFailures('masters'), [failed.jobId]);
	assert.deepEqual(fixture.controls, [['retry', { jobId: failed.jobId }]]);
	assert.deepEqual(fixture.queue.list().entries.map(({ state }) => state), [
		'queued', 'completed', 'cancelled', 'failed',
	]);
});

test('reauthorizing a destination returns the grant and refreshes its waiting jobs', async () => {
	const waiting = entry('66'.repeat(24), 'needs-authorization');
	const fixture = queueFixture([waiting]);
	await fixture.queue.refresh();

	assert.deepEqual(await fixture.queue.reauthorizeDestination(GRANT_ID), { grantId: GRANT_ID });
	assert.deepEqual(fixture.controls, [['reauthorizeDestination', { grantId: GRANT_ID }]]);
	assert.equal(fixture.queue.list().entries[0]!.state, 'queued');
});

test('a rejected retry preserves its failure and the queue mirror', async () => {
	const failed = entry('22'.repeat(24), 'failed');
	const fixture = queueFixture([failed]);
	const failure = new Error('The queue could not persist the retry.');
	fixture.bridge.retry = async () => { throw failure; };
	await fixture.queue.refresh();
	const readsBefore = fixture.listReads();

	await assert.rejects(fixture.queue.retry(failed.jobId), (error: unknown) => error === failure);
	assert.equal(fixture.listReads(), readsBefore);
	assert.equal(fixture.queue.list().entries[0]!.state, 'failed');
});

function queueFixture(initialEntries: readonly SoundscaperPersistentDeliverySummary[]) {
	let entries = [...initialEntries];
	let reads = 0;
	const controls: Array<readonly [string, unknown]> = [];
	const enqueues: SoundscaperPersistentDeliveryEnqueueRequest[] = [];
	const bridge: SoundscaperPersistentDeliveryRendererBridge = {
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
	const queue = createSoundscaperPersistentDeliveryUiService({
		bridge,
		getProject: () => ({ id: IDENTITY.projectId, revision: IDENTITY.projectRevision, title: 'Album' }),
		getSaveState: () => 'saved',
		captureProjectGeneration: () => ({ generation: 1, projectId: IDENTITY.projectId }),
		assertProjectGeneration: () => undefined,
		describeMember: async () => ({ settings: SETTINGS, exportPlan: EXPORT_PLAN }),
	});
	return { queue, bridge, controls, enqueues, listReads: () => reads };
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
