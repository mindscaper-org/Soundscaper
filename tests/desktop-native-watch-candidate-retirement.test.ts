/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { initializeFramescaperNativeServicesDatabase, acquireFramescaperNativeServicesWriterLease } from '../desktop/native-services-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from '../desktop/native-services-database-v3.ts';
import { FramescaperNativeRootRepository } from '../desktop/native-services-root-repository.ts';
import { FramescaperNativeWatchRepository, FramescaperNativeWatchReconciler } from '../desktop/native-services-watch-repository.ts';

test('disabled and removed watch rules retire candidates, including a scan already in flight', async context => {
	const database = new DatabaseSync(':memory:');
	context.after(() => { database.close(); });
	initializeFramescaperNativeServicesDatabase(database); initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, { leaseId: 'watch-retirement', instanceId: 'watch', processId: 1, nowMs: 0 });
	const roots = new FramescaperNativeRootRepository(database);
	const grantId = 'ff'.repeat(16); const ruleId = 'aa'.repeat(16);
	roots.authorize({ grantId, rootPath: '/ingest', volumeIdentity: 'volume', directoryIdentity: 'directory', authorizedAtMs: 0 }, lease, 0);
	const repository = new FramescaperNativeWatchRepository(database);
	repository.create({ schemaFamily: 'framescaper', schemaVersion: 1, ruleId, grantId, projectId: 'project', binId: 'project-bin', extensions: ['mov'], createdAtMs: 0 }, lease, 0);
	const entries = [{ name: 'camera.mov', fileIdentity: 'file', sizeBytes: 100, modifiedAtMs: 0, isDirectory: false, symbolicLink: false }];
	let release: (() => void) | undefined;
	let pending = false;
	const originalSet = Map.prototype.set;
	let retained: Map<unknown, unknown> | undefined;
	context.mock.method(Map.prototype, 'set', function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
		const result = originalSet.call(this, key, value) as Map<unknown, unknown>;
		if (key === ruleId && value instanceof Map && new Error().stack?.includes('native-services-watch-repository')) retained = result;
		return result;
	});
	const reconciler = new FramescaperNativeWatchReconciler({ repository, roots, lease: () => lease,
		scan: async () => { if (pending) await new Promise<void>(resolve => { release = resolve; }); return entries; },
		probe: async () => ({ succeeded: true, contentSha256: 'ab'.repeat(32) }),
		projectState: () => ({ schemaFamily: 'framescaper', schemaVersion: 1, open: false, writable: false, binId: 'project-bin' }),
		importFile: async () => false,
	});
	await reconciler.reconcile(0); assert.equal(retained?.size, 1);
	repository.setEnabled(ruleId, false, lease, 1);
	await reconciler.reconcile(1); assert.equal(retained?.size, 0);
	repository.setEnabled(ruleId, true, lease, 2);
	pending = true;
	const sweep = reconciler.reconcile(2);
	assert.ok(release);
	repository.setEnabled(ruleId, false, lease, 3); repository.remove(ruleId, lease, 3);
	release(); await sweep;
	assert.equal(retained?.size, 0, 'a retired in-flight scan cannot reinsert its candidate map');
});
