/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeFramescaperNativeServicesDatabase, acquireFramescaperNativeServicesWriterLease } from '../desktop/native-services-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from '../desktop/native-services-database-v3.ts';
import { FramescaperNativeQueueRepository } from '../desktop/native-services-queue-repository-v3.ts';
import { FramescaperNativeRootRepository } from '../desktop/native-services-root-repository.ts';
import { FramescaperNativeWatchRepository } from '../desktop/native-services-watch-repository.ts';
import { FramescaperNativeServicesControllerV3 } from '../desktop/native-services-controller-v3.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createFramescaperNativeServicesStore } from '../src/common/editor/ui/framescaper-native-services-bridge.ts';

function fixture() {
	const project = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project));
	const database = new DatabaseSync(':memory:'); initializeFramescaperNativeServicesDatabase(database); initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, { leaseId: 'status-lease', instanceId: 'status', processId: 1, nowMs: 0 });
	const roots = new FramescaperNativeRootRepository(database); roots.authorize({ grantId: 'ab'.repeat(16), rootPath: '/output', volumeIdentity: 'volume', directoryIdentity: 'directory', authorizedAtMs: 0 }, lease, 0);
	const queue = new FramescaperNativeQueueRepository(database);
	for (let index = 0; index < 8; index += 1) queue.enqueue(createNativeQueueRecordV3({ schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: index.toString(16).padStart(40, '0'), taskKind: 'encoded-export', plan, projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [], rootGrantId: 'ab'.repeat(16), relativeDestination: `renders/${String(index)}.mov`, position: index, createdAtMs: 0,
		reservations: { cpuCores: 1, processTreeRssBytes: 1024, scratchBytes: 4096, minimumFreeBytes: 0, hardwareBackend: null } }), lease, 1);
	const controller = new FramescaperNativeServicesControllerV3({ queue, roots, watch: new FramescaperNativeWatchRepository(database), lease: () => lease });
	return { database, queue, controller };
}

test('native status polling reads only validated scalar queue projections and leaves execution admission strict', context => {
	const { database, queue, controller } = fixture(); context.after(() => { database.close(); });
	const expected = controller.snapshot(); const parse = JSON.parse; let planParses = 0;
	context.mock.method(JSON, 'parse', (value: string) => { if (value.includes('"version":14')) planParses += 1; return parse(value) as unknown; });
	assert.deepEqual(controller.snapshot(), expected); assert.deepEqual(controller.snapshot(), expected);
	assert.equal(planParses, 0, 'status does not hydrate any canonical plan');
	context.mock.restoreAll();
	database.prepare('UPDATE render_queue_jobs SET plan_payload = ? WHERE job_id = ?').run('broken plan JSON', '0'.repeat(40));
	assert.deepEqual(controller.snapshot(), expected, 'status remains an exact scalar projection');
	assert.throws(() => queue.read('0'.repeat(40)), /JSON|plan/iu, 'execution still authenticates complete plan custody');
});

test('unchanged native status refreshes retain snapshot identity and share unchanged sections on progress updates', async context => {
	const { database, controller } = fixture(); context.after(() => { database.close(); });
	let reads = 0; let clock = 0; let notifications = 0;
	const store = createFramescaperNativeServicesStore({ snapshot: async () => { reads += 1; return controller.snapshot(); },
		control: async () => { throw new Error('unused'); }, reorder: async () => [], remove: async () => true }, () => clock);
	store.subscribe(() => { notifications += 1; });
	const first = await store.refresh(); clock = 10_000; const second = await store.refresh();
	assert.equal(second, first); assert.equal(notifications, 1);
	store.refreshIfStale(10_001); assert.equal(reads, 2, 'unchanged responses still refresh the poll clock');
	database.prepare('UPDATE render_queue_jobs SET progress = ? WHERE job_id = ?').run(0.5, '0'.repeat(40));
	const third = await store.refresh(); assert.notEqual(third, first); assert.equal(notifications, 2);
	assert.equal(third.services.roots, first.services.roots); assert.equal(third.services.queue[1], first.services.queue[1]);
	assert.equal(third.services.queue[0]!.progress, 0.5);
});
