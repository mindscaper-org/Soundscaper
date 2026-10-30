/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { FramescaperNativeProjectMediaAuthority } from '../desktop/native-services-project-media-authority.ts';
import { createNativeQueueRecordWithDeferredTimingReferencesV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { nativeRenderInputExactEnvelope } from '../desktop/native-services-render-input-contract.ts';
import { canonicalizeNativeMediaPlan, fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { assertNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { createFramescaperNativeRenderQueueActionRuntimeNativeMedia } from '../src/framescaper/editor-native-render-queue-action.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';

function vfrProject() {
	const options = framescaperV20Options();
	const rawSource = (options.sources as Record<string, unknown>[]).find(source => source.kind === 'video')!;
	const publication = createVideoTimingAssetPublication(String(rawSource.contentSha256), {
		timescale: 1000, presentationTicks: [0n, 50n, 150n, 250n, 350n, 450n, 550n, 650n, 750n, 900n], finalFrameDurationTicks: 100n });
	Object.assign(rawSource, { timingAsset: publication.reference, timingDecision: { mode: 'exact', rate: { num: 10, den: 1 }, backend: 'demuxer' } });
	const project = createFramescaperProjectNativeMedia(PROFILE, options);
	const source = (project.sources as readonly Record<string, unknown>[]).find(candidate => candidate.kind === 'video')!;
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	return { project, source, publication };
}

test('the native render menu carries its verified VFR plan into desktop queue admission', async context => {
	const { project, source } = vfrProject();
	context.after(() => { unregisterVideoTimingIndex(source); });
	const scope = globalThis as unknown as Record<string, unknown>; const previous = scope.framescaperDesktop;
	let snapshots = 0;
	scope.framescaperDesktop = { v1: { nativeServices: {
		snapshot: async () => { snapshots += 1; throw new Error('verified plan reached desktop admission'); },
		control: async () => undefined, reorder: async () => [], remove: async () => false, capabilities: async () => null,
	} } };
	context.after(() => { if (previous === undefined) delete scope.framescaperDesktop; else scope.framescaperDesktop = previous; });
	const runtime = createFramescaperNativeRenderQueueActionRuntimeNativeMedia(PROFILE, { project });
	await assert.rejects(runtime.run('render-queue-enqueue'), /verified plan reached desktop admission/u);
	assert.equal(snapshots, 1);
});


test('durable VFR custody rebinds verified bodies before the native executor and refuses altered timing', async context => {
	const { project, source, publication } = vfrProject();
	context.after(() => { unregisterVideoTimingIndex(source); });
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project));
	const planPayload = canonicalizeNativeMediaPlan(plan); const planFingerprint = fingerprintNativeMediaPlan(plan).sha256;
	const metadata = nativeRenderInputExactEnvelope(planPayload, planFingerprint);
	assert.equal(metadata.planVersion, 14);
	if (metadata.planVersion !== 14) return;
	assert.equal(metadata.plan.sources[0]!.timing.kind, 'vfr');
	const root = { grantId: 'ab'.repeat(16), rootPath: '/exports', volumeIdentity: 'volume', directoryIdentity: 'directory', authorizedAtMs: 1, revokedAtMs: null };
	const bodies = [{ kind: 'video-original', encoding: 'blob-v1', sourceId: String(source.id), storageKey: String(source.id),
		mimeType: 'video/mp4', byteLength: 4, sha256: String(source.contentSha256) },
	{ kind: 'video-timing', encoding: publication.reference.encoding, sourceId: publication.reference.storageKey, storageKey: publication.reference.storageKey,
		mimeType: 'application/vnd.soundscaper.video-timing', byteLength: publication.bytes.byteLength, sha256: publication.reference.sha256 }];
	const family = { schemaFamily: 'framescaper' as const, schemaVersion: 1 as const };
	let corrupt = false; let executions = 0;
	const authority = new FramescaperNativeProjectMediaAuthority({
		project: { ...family, projectRecord: () => ({ ...family, projectId: String(project.id), projectRevision: Number(project.revision), projectSha256: 'ef'.repeat(32), bodies }),
			readProjectBundle: async () => ({ project: { ...family, projectRevision: Number(project.revision), sha256: 'ef'.repeat(32) }, bodies }),
			readBody: async () => { const bytes = new Uint8Array(publication.bytes); if (corrupt) bytes[bytes.length - 1] ^= 1; return bytes; },
			materializeBody: async () => { throw new Error('materialization is outside this focused execution seam'); } },
		watch: { projectState: () => ({ ...family, open: true, writable: true, binId: 'project-bin' }) },
		runtime: { available: () => true, executeProxyV14: async () => { throw new Error('proxy must not run'); },
			executeV14: async request => { executions += 1; assertNativeMediaPlanEnvelopeV2(request.attempt.envelope);
				assert.deepEqual(request.timingBodies[0]!.bytes, publication.bytes);
				return { planFingerprint, byteLength: 128, sha256: '12'.repeat(32), publication: 'verified-temporary' }; } },
		renderInputs: { revalidate: async () => true, inspect: async () => ({ byteLength: 16, materialize: async () => [] }), settle: async () => undefined },
		platform: 'linux', probeRoot: async () => ({ exists: true, directory: true, symbolicLink: false, canonicalPath: root.rootPath,
			volumeIdentity: root.volumeIdentity, directoryIdentity: root.directoryIdentity }),
		publicationPortFor: () => { throw new Error('publication is outside this focused execution seam'); },
		publicationFenceFor: () => { throw new Error('publication is outside this focused execution seam'); },
	});
	const request = { ...family, taskKind: 'encoded-export' as const, planVersion: 14 as const, derivedInputStageId: null,
		planFingerprint, planPayload, projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: String(source.id), sha256: String(source.contentSha256) }], rootGrantId: root.grantId,
		relativeDestination: 'renders/vfr.mov', reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3, scratchBytes: 1024 ** 2,
			minimumFreeBytes: 0, hardwareBackend: null }, recoveryClass: 'atomic-restart' as const };
	const reservations = authority.queueReservations(request, 16);
	const record = createNativeQueueRecordWithDeferredTimingReferencesV3({ ...request, plan, reservations, jobId: 'cd'.repeat(20), position: 0, createdAtMs: 1 });
	const prepared = await authority.prepare(record, root); assert.ok(prepared.execute);
	await prepared.execute({ signal: new AbortController().signal, onProgress() {} }); assert.equal(executions, 1);
	await prepared.cleanup?.('succeeded');
	corrupt = true; await assert.rejects(authority.prepare(record, root), /digest|timing/iu); assert.equal(executions, 1);
});
