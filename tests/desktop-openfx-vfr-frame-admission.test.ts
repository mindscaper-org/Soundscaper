/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperOpenFxFrameExecutionService, admitFramescaperOpenFxFrameControlV1 } from '../desktop/framescaper-openfx-frame-execution.ts';
import { canonicalizeNativeMediaPlan, fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV2, assertNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from '../src/common/editor/native-media-plan-video-timing.ts';
import { createUnifiedExactRenderPlanWithTimingSidecars } from '../src/common/editor/unified-exact-render-plan.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { unifiedExactVfrPlanFixture } from './helpers/unified-exact-vfr-plan-fixture.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

function fixture() {
	const vfr = unifiedExactVfrPlanFixture(14, '77'.repeat(32));
	const effect = unifiedExactPlanFixture(12).nodes.find(node => node.kind === 'openfx');
	assert.ok(effect && 'state' in effect);
	const project = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
	const baseline = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project));
	const finishing = baseline.nodes.find(node => node.kind === 'finishing'); assert.ok(finishing?.kind === 'finishing');
	const plan = createUnifiedExactRenderPlanWithTimingSidecars({ ...vfr.plan, deliveryProfile: 'encode-mp4-h264',
		output: { ...vfr.plan.output, canvas: { ...vfr.plan.output.canvas, width: 2, height: 2 } }, nodes: [
			...vfr.plan.nodes, { ...effect, state: { ...effect.state, pluginId: 'org.framescaper.conformance', context: 'retimer',
				attachment: { kind: 'retimer', targetId: 'vfr-clip' }, inputs: [{ name: 'Source', sourceRef: 'vfr-source' }], parameters: [], frozenFallback: null } },
			{ ...finishing, sequenceId: 'sequence-1', colorContext: { ...finishing.colorContext, sequenceId: 'sequence-1' },
				sourceInterpretations: finishing.sourceInterpretations.map(source => ({ ...source, sourceId: 'vfr-source' })),
				visualPresentations: [], processorStacks: [], motionAnalyses: [], captionTracks: [] },
		] }, vfr.timingSidecars);
	return { vfr, effect, plan };
}

test('VFR frame control admits references, then authenticates exact main-owned timing before OpenFX execution', async () => {
	const { vfr, effect, plan } = fixture();
	const owned = createNativeMediaPlanEnvelopeV2(plan, vfr.timingSidecars);
	assert.doesNotThrow(() => assertNativeMediaPlanEnvelopeV2(owned));
	assert.throws(() => assertNativeMediaPlanEnvelopeV2({ ...owned }), /verified timing asset sidecars/u);
	const control = { protocolVersion: 1 as const, schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		planPayload: canonicalizeNativeMediaPlan(plan), planFingerprint: fingerprintNativeMediaPlan(plan).sha256,
		instanceId: effect.state.instanceId, outputOrdinal: 0, requestedBackend: 'cpu' as const, transitionProgress: null };
	assert.equal(admitFramescaperOpenFxFrameControlV1(control).plan.sources[0]!.timing.kind, 'vfr');
	let executions = 0; let timingReads = 0; let mode: 'valid' | 'missing' | 'corrupt' = 'valid';
	const service = createFramescaperOpenFxFrameExecutionService({
		inventory: () => [{ pluginHandle: 'ab'.repeat(20), pluginId: 'org.framescaper.conformance', binarySha256: effect.state.binarySha256, state: 'enabled', quarantined: false, vendor: null, version: { major: 1, minor: 0 }, supportedContexts: ['retimer'], parameters: [], components: ['RGBA'], pixelDepths: ['byte'], threading: 'unsafe' }],
		currentProject: () => true, supportedGpuBackends: () => [],
		timingAssets: async () => { timingReads += 1; if (mode === 'missing') return [];
			const bytes = new Uint8Array(vfr.publication.bytes); if (mode === 'corrupt') bytes[bytes.length - 1] ^= 1;
			return nativeMediaPlanVideoTimingAssetInputs(plan).map(input => ({ input, bytes })); },
		execute: async request => { executions += 1; assert.ok(request.retimerSourceTime); throw new Error('authenticated execution reached'); },
	});
	const request = { ...control, inputs: [{ name: 'Source', sourceRef: 'vfr-source', width: 2, height: 2, rgba: new Uint8Array(16) }] };
	await assert.rejects(service.execute(request), /authenticated execution reached/u);
	assert.equal(executions, 1); assert.equal(timingReads, 1);
	mode = 'missing'; await assert.rejects(service.execute(request), /timing|asset/iu);
	mode = 'corrupt'; await assert.rejects(service.execute(request), /timing|digest/iu);
	assert.equal(executions, 1, 'missing or forged sidecars never reach execution');
});
