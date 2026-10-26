/* SPDX-License-Identifier: AGPL-3.0-only */

import { authenticateNativePlanVideoTimingAssetsV1OrV2 } from './native-services-video-timing-staging.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from '../src/common/editor/native-media-plan-video-timing.ts';
import type { NativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';

/** Replace declarative custody with an owned envelope only after every exact SCTI body authenticates. */
export function authenticateFramescaperNativeV14TimingEnvelope(
	plan: unknown,
	timings: readonly Readonly<{ sourceId: string; sha256: string; bytes: Uint8Array }>[],
	maximumStagedBytes: number,
): NativeMediaPlanEnvelopeV2 {
	try {
		const inputs = nativeMediaPlanVideoTimingAssetInputs(plan);
		if (timings.length !== inputs.length) throw new Error('The V14 plan lost its exact timing body inventory.');
		const assets = inputs.map((input, index) => {
			const timing = timings[index];
			if (!timing || timing.sourceId !== input.sourceId || timing.sha256 !== input.sha256) {
				throw new Error('A V14 timing body is outside its plan order and source authority.');
			}
			return { input, bytes: timing.bytes };
		});
		const envelope = authenticateNativePlanVideoTimingAssetsV1OrV2({ plan, assets, maximumStagedBytes }).envelope;
		if (envelope.envelopeVersion !== 2 || envelope.planVersion !== 14) throw new Error('Native V14 timing authority changed its plan generation.');
		return envelope;
	} catch (error) {
		for (const timing of timings) timing.bytes.fill(0);
		throw error;
	}
}
