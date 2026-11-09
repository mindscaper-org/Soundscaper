/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductNativeRenderInputOperation } from '../common/editor/controller/composition/product-native-render-input-authority.ts';
import { canonicalizeNativeMediaPlan, fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV2, createNativeMediaPlanEnvelopeWithDeferredTimingReferencesV2 } from '../common/editor/native-media-plan-envelope-v2.ts';
import type { UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import { resolveVideoSourceTimingViews } from '../common/editor/video-source-timing-views.ts';
import { framescaperNativePlanTimingAuthority } from './editor-native-plan-timing-authority.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from './editor-native-render-plan-authority.ts';
import { framescaperNativeRenderDeliveryRequestFromPlanNativeMedia } from './editor-native-project-action-requests.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from './editor-project-unified-render-plan-native-media.ts';
import { cloneFramescaperProjectNativeMedia, type FramescaperProjectNativeMedia } from './editor-project-native-media.ts';
import type {
	FramescaperNativeRenderInputRequestNativeMedia,
} from './editor-native-render-input-producer.ts';

export {
	admitFramescaperNativeRenderInputAuthorityNativeMedia,
	admitFramescaperNativeRenderInputRequestNativeMedia,
} from './editor-native-render-input-request.ts';

export function currentFramescaperNativeRenderProjectNativeMedia(
	profile: unknown,
	value: unknown,
	request: FramescaperNativeRenderInputRequestNativeMedia,
): FramescaperProjectNativeMedia {
	const project = cloneFramescaperProjectNativeMedia(profile, value);
	if (project.id !== request.projectId || project.revision !== request.projectRevision) {
		throw new Error('The selected nativeMedia native render request is stale.');
	}
	return project;
}

export function currentFramescaperNativeRenderPlanNativeMedia(
	profile: unknown,
	project: FramescaperProjectNativeMedia,
	request: FramescaperNativeRenderInputRequestNativeMedia,
): UnifiedExactRenderPlanV14 {
	let parsed: unknown;
	try { parsed = JSON.parse(request.planPayload) as unknown; }
	catch (cause) { throw new TypeError('The selected nativeMedia native render plan is not JSON.', { cause }); }
	const declaration = createNativeMediaPlanEnvelopeWithDeferredTimingReferencesV2(parsed);
	const envelope = createNativeMediaPlanEnvelopeV2(declaration.plan, framescaperNativePlanTimingAuthority(project, resolveVideoSourceTimingViews(project), declaration.summary.videoTimingAssetInputs.map(input => input.sourceId)));
	if (envelope.planVersion !== 14 || canonicalizeNativeMediaPlan(parsed) !== request.planPayload
		|| envelope.fingerprint !== request.planFingerprint) {
		throw new Error('The selected nativeMedia native render plan has no exact V14 identity.');
	}
	const delivery = framescaperNativeRenderDeliveryRequestFromPlanNativeMedia(
		envelope.plan as UnifiedExactRenderPlanV14,
	);
	const expected = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		profile, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project, delivery), delivery,
	);
	if (canonicalizeNativeMediaPlan(expected) !== request.planPayload
		|| fingerprintNativeMediaPlan(expected).sha256 !== request.planFingerprint) {
		throw new Error('The selected nativeMedia render plan changed from its current project authority.');
	}
	return envelope.plan as UnifiedExactRenderPlanV14;
}

export function assertFramescaperNativeRenderOperationCurrentNativeMedia(
	operation: ProductNativeRenderInputOperation,
): void {
	if (operation.signal.aborted) {
		throw operation.signal.reason
			?? new DOMException('nativeMedia carrier production was cancelled.', 'AbortError');
	}
	operation.assertCurrent();
}
