/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FramescaperNativeProxyOutputBroker } from '../desktop/native-services-proxy-output-broker.ts';
import { createNativeQueueRecordV3, type NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperNativeProxySourcePlan } from '../src/framescaper/editor-native-proxy-source-plan.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

test('publishing unrelated proxy receipts performs bounded queue reads and retains valid completed outputs', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'proxy-receipt-work-')); context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const project = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options()); const plan = createFramescaperNativeProxySourcePlan(project, 'video-source');
	const root = { grantId: 'ab'.repeat(16), rootPath: directory, volumeIdentity: 'volume', directoryIdentity: 'directory', authorizedAtMs: 0, revokedAtMs: null };
	const records = new Map<string, NativeQueueRecordV3>(); let reads = 0;
	const broker = new FramescaperNativeProxyOutputBroker({ queueRecord: jobId => { reads += 1; return records.get(jobId) ?? null; },
		rootGrant: () => root, mintClaimId: () => 'cd'.repeat(20) });
	context.after(async () => { await broker.dispose(); });
	const bytes = new Uint8Array([1, 2, 3]); const sha256 = createHash('sha256').update(bytes).digest('hex');
	await writeFile(join(directory, '0.mov'), bytes);
	for (let index = 0; index < 64; index += 1) {
		const record = { ...createNativeQueueRecordV3({ schemaFamily: 'framescaper', schemaVersion: 1, jobId: index.toString(16).padStart(40, '0'),
			taskKind: 'proxy-generation', plan, projectId: String(project.id), projectRevision: Number(project.revision), inputFingerprints: [],
			rootGrantId: root.grantId, relativeDestination: `${String(index)}.mov`, position: index, createdAtMs: 0,
			reservations: { cpuCores: 1, processTreeRssBytes: 1024, scratchBytes: 4096, minimumFreeBytes: 0, hardwareBackend: null } }), state: 'running' as const };
		records.set(record.jobId, record); broker.recordPublished(record, root, { planFingerprint: record.planFingerprint, byteLength: bytes.byteLength, sha256 });
		records.set(record.jobId, { ...record, state: 'completed', progress: 1 });
	}
	assert.ok(reads <= 64 * 8, `publication reread ${String(reads)} unrelated queue rows`);
	const owner = {}; const claim = await broker.claim(owner, { jobId: '0'.repeat(40) });
	assert.deepEqual(await broker.read(owner, { claimId: claim.claimId, offset: 0, length: 3 }), bytes);
	await broker.release(owner, { claimId: claim.claimId });
	records.delete('0'.repeat(40)); await assert.rejects(broker.claim(owner, { jobId: '0'.repeat(40) }), /not available/u);
});
