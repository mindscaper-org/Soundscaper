/* SPDX-License-Identifier: AGPL-3.0-only */
import { BINAURAL_RENDERER_ID, BINAURAL_RENDERER_LIMITATIONS } from './binaural-render.ts';
import type { DeliveryConversion } from './delivery-conversion-inventory.ts';
import manifest from './ear/source-manifest.json';

export function spatialDeliveryConversions(plan: Readonly<{ binaural?: unknown; ear?: unknown }>): readonly DeliveryConversion[] {
	const ear = plan.ear;
	if (!isRecord(ear)) return binauralConversions(plan.binaural);
	return [{ code: 'delivery.ear-render', disposition: 'converted', severity: 'info',
		data: { renderer: 'ebu-libear', version: manifest.version, revision: manifest.revision,
			layout: ear.layout, sourceChannels: ear.sourceChannelCount, outputChannels: ear.channelCount,
			notices: new URL('./ear/THIRD_PARTY_NOTICES.txt', import.meta.url).href,
			limitations: ['Static authored DirectSpeakers and point objects only.', 'Speaker rendering; no binaural HRTF, Dolby Atmos codec, or certification.'] },
		message: 'The authored ADM bed and objects were rendered to the selected speaker layout using EBU libear (ITU-R BS.2127).',
	}];
}

/**
 * The renderer decision a binaural delivery has to state.
 *
 * A programme rendered to two channels is no longer the programme: its bed and
 * its objects were placed by a model, and which model that was decides what the
 * listener hears. The item names the renderer and carries its own limitations,
 * so nothing downstream has to know this module to find out what was assumed.
 */
function binauralConversions(binaural: unknown): readonly DeliveryConversion[] {
	if (!isRecord(binaural)) return [];
	const metadata = isRecord(binaural.metadata) ? binaural.metadata : null;
	const bed = metadata && isRecord(metadata.bed) ? metadata.bed : null;
	return Object.freeze([{
		code: 'delivery.binaural-render',
		disposition: 'converted',
		severity: 'warning',
		data: {
			renderer: BINAURAL_RENDERER_ID,
			sourceChannels: Number(binaural.sourceChannelCount) || null,
			bedLayout: typeof bed?.layout === 'string' ? bed.layout : null,
			objects: Array.isArray(metadata?.objects) ? metadata.objects.length : 0,
			limitations: BINAURAL_RENDERER_LIMITATIONS,
		},
		message: 'The programme was rendered to two channels for headphones by a parametric spherical-head model. '
			+ 'It carries no measured head-related transfer function, so elevation is conveyed by arrival time and '
			+ 'shadow rather than by spectral cues.',
	}]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
