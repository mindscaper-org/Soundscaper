/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { framescaperNativeProjectPlanBodyMetadataMatches, framescaperNativeOriginalBodyForInput } from '../desktop/native-services-project-body-custody.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FramescaperNativeProjectMediaAuthority } from '../desktop/native-services-project-media-authority.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

function fixture() {
	const options = framescaperV20Options(); const sources = options.sources as Record<string, unknown>[];
	const clips = options.clips as Record<string, unknown>[]; const tracks = options.tracks as Record<string, unknown>[];
	const source = sources.find(candidate => candidate.kind === 'video')!; const clip = clips.find(candidate => candidate.kind === 'video')!;
	const track = tracks.find(candidate => candidate.type === 'video')!;
	for (let index = 1; index < 24; index += 1) {
		const sourceId = `source-${String(index)}`; const clipId = `clip-${String(index)}`;
		sources.push({ ...source, id: sourceId, storageKey: sourceId, contentSha256: index.toString(16).padStart(64, '0') });
		clips.push({ ...clip, id: clipId, sourceId, sequenceStartFrame: index * Number(clip.sequenceFrameCount) }); (track.clipIds as string[]).push(clipId);
	}
	const project = createFramescaperProjectNativeMedia(PROFILE, options);
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project));
	const inputs = plan.sources.map(candidate => ({ sourceId: candidate.sourceId, sha256: candidate.contentSha256 }));
	const bodies = inputs.map(input => ({ kind: 'video-original' as const, encoding: 'blob-v1', sourceId: input.sourceId, storageKey: input.sourceId,
		mimeType: 'video/mp4', byteLength: 16, sha256: input.sha256 }));
	return { project, plan, inputs, bodies };
}

test('one body-custody operation admits its external plan once across all source lookups', context => {
	const { plan, inputs, bodies } = fixture(); const parse = JSON.parse; let planClones = 0;
	context.mock.method(JSON, 'parse', (value: string) => { if (value.includes('"version":14')) planClones += 1; return parse(value) as unknown; });
	assert.equal(framescaperNativeProjectPlanBodyMetadataMatches(plan, inputs, bodies), true);
	assert.equal(planClones, 1, 'source count does not multiply complete canonical plan clones');
	context.mock.restoreAll();
	assert.equal(framescaperNativeProjectPlanBodyMetadataMatches(plan, inputs, [...bodies, bodies[0]!]), false);
	assert.equal(framescaperNativeProjectPlanBodyMetadataMatches(plan, inputs, bodies.slice(1)), false);
	const original = bodies[0]!.sha256; bodies[0]!.sha256 = 'ff'.repeat(32);
	assert.equal(framescaperNativeProjectPlanBodyMetadataMatches(plan, inputs, bodies), false, 'new calls observe mutable caller inventories');
	bodies[0]!.sha256 = original;
	assert.deepEqual(framescaperNativeOriginalBodyForInput(plan, inputs[0]!, bodies), bodies[0]);
});


test('actual main queue reservation shares its prepared source custody across every original', context => {
	const { project, plan, inputs, bodies } = fixture(); const family = { schemaFamily: 'framescaper' as const, schemaVersion: 1 as const };
	const authority = new FramescaperNativeProjectMediaAuthority({
		project: { ...family, projectRecord: () => ({ ...family, projectId: String(project.id), projectRevision: Number(project.revision), projectSha256: 'ef'.repeat(32), bodies }),
			readProjectBundle: async () => { throw new Error('reservation does not read bodies'); }, readBody: async () => { throw new Error('reservation does not read bodies'); },
			materializeBody: async () => { throw new Error('reservation does not materialize bodies'); } },
		watch: { projectState: () => ({ ...family, open: true, writable: true, binId: 'project-bin' }) },
		runtime: { available: () => true, executeProxyV14: async () => { throw new Error('reservation does not execute'); }, executeV14: async () => { throw new Error('reservation does not execute'); } },
		renderInputs: { revalidate: async () => true, inspect: async () => { throw new Error('reservation does not stage'); }, settle: async () => undefined },
		platform: 'linux', probeRoot: async () => { throw new Error('reservation does not probe roots'); },
		publicationPortFor: () => { throw new Error('reservation does not publish'); }, publicationFenceFor: () => { throw new Error('reservation does not publish'); },
	});
	const fingerprint = fingerprintNativeMediaPlan(plan); const parse = JSON.parse; let planParses = 0;
	context.mock.method(JSON, 'parse', (value: string) => { if (value.includes('"version":14')) planParses += 1; return parse(value) as unknown; });
	const reservation = authority.queueReservations({ ...family, taskKind: 'encoded-export', planVersion: 14, derivedInputStageId: null,
		planPayload: fingerprint.canonical, planFingerprint: fingerprint.sha256, projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: inputs, rootGrantId: 'ab'.repeat(16), relativeDestination: 'renders/prepared.mov', recoveryClass: 'atomic-restart',
		reservations: { cpuCores: 1, processTreeRssBytes: 1024, scratchBytes: 1024, minimumFreeBytes: 0, hardwareBackend: null } }, 4096);
	assert.ok(reservation.scratchBytes > 4096);
	assert.equal(planParses, 2, 'one wire parse and one detached canonical snapshot serve every source and capacity query');
});
