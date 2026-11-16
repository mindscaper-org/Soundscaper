/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveBinauralDelivery } from './binaural-delivery.ts';
import { resolveEarDelivery } from './ear-delivery.ts';
import { resolveBw64Adm } from './export-bw64-adm.js';
import type { EarDeliveryPlan } from './ear-delivery.ts';

export function resolveSpatialDelivery(
	project: Readonly<{ metadata?: Readonly<{ adm?: unknown }> }>,
	options: Readonly<Record<string, unknown>>,
	format: string,
	mode: string,
) {
	const metadata = options.adm !== undefined ? options.adm : project.metadata?.adm;
	const ear = resolveEarDelivery(metadata, { ...options, format, mode });
	if (ear) resolveBw64Adm(project, { adm: ear.metadata, channelMapping: 'preserve', inputChannelCount: ear.sourceChannelCount });
	const { plan: binaural, refusal } = resolveBinauralDelivery(metadata as Parameters<typeof resolveBinauralDelivery>[0], { binaural: options.binaural, mode, format });
	if (refusal !== null && refusal !== 'not-requested') throw new Error(`A binaural delivery is not available: ${refusal}.`);
	return { ear, binaural };
}

export function spatialLoudnessMetadata(ear: EarDeliveryPlan | null, fallback: unknown): unknown {
	if (!ear) return fallback;
	return { ...ear.metadata, bed: { ...ear.metadata.bed, layout: ear.layout, assignments: [] }, objects: [] };
}

/** The worker clones its inputs and returns one additional output buffer. */
export function spatialRenderWorkingSetBytes(ear: EarDeliveryPlan | null, frames: number): number {
	return ear ? 32 * 1024 ** 2 + frames * 4 * (ear.sourceChannelCount + 2 * ear.channelCount) : 0;
}
