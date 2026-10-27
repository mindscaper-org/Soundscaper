/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initializeFramescaperNativeServicesDatabase, acquireFramescaperNativeServicesWriterLease } from '../desktop/native-services-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from '../desktop/native-services-database-v3.ts';
import { FramescaperNativeRootRepository } from '../desktop/native-services-root-repository.ts';
import { FramescaperNativeWatchRepository } from '../desktop/native-services-watch-repository.ts';
import { FramescaperNativeWatchCoordinator } from '../desktop/native-services-watch-coordinator.ts';

test('unrelated output-root changes retain exact watch hints while changed or disabled rules close theirs', async context => {
	const database = new DatabaseSync(':memory:'); context.after(() => { database.close(); });
	initializeFramescaperNativeServicesDatabase(database); initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, { leaseId: 'hint-lease', instanceId: 'hints', processId: 1, nowMs: 0 });
	const roots = new FramescaperNativeRootRepository(database); const repository = new FramescaperNativeWatchRepository(database);
	const grant = 'ab'.repeat(16); const other = 'cd'.repeat(16); const ruleId = 'ef'.repeat(16);
	const authorize = (grantId: string, rootPath: string) => roots.authorize({ grantId, rootPath, volumeIdentity: 'volume', directoryIdentity: rootPath, authorizedAtMs: 0 }, lease, 0);
	authorize(grant, '/ingest');
	const create = (grantId: string) => repository.create({ schemaFamily: 'framescaper', schemaVersion: 1, ruleId, grantId,
		projectId: 'project', binId: 'project-bin', extensions: ['mov'], createdAtMs: 0 }, lease, 0);
	create(grant); let opened = 0; let closed = 0; let reconciled = 0;
	const coordinator = new FramescaperNativeWatchCoordinator({ repository, roots, reconcile: async () => { reconciled += 1; },
		watch: () => { opened += 1; return { close() { closed += 1; } }; }, schedule: () => ({}), cancelSchedule() {} });
	await coordinator.start(); assert.equal(opened, 1); assert.equal(reconciled, 1);
	authorize(other, '/exports'); coordinator.refreshHints(); assert.equal(opened, 1); assert.equal(closed, 0);
	repository.setEnabled(ruleId, false, lease, 1); repository.remove(ruleId, lease, 1); create(other); coordinator.refreshHints(); assert.equal(opened, 2); assert.equal(closed, 1);
	repository.setEnabled(ruleId, false, lease, 2); coordinator.refreshHints(); assert.equal(closed, 2);
	await coordinator.reconcileNow(); assert.equal(reconciled, 2, 'periodic authoritative reconciliation is independent of hint reuse');
	await coordinator.drain(); assert.equal(closed, 2);
});
