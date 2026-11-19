/* SPDX-License-Identifier: AGPL-3.0-only */
import { authoredAdmDeliveryChannelCount, normalizeAdmProjectMetadata, type AdmAuthoredMetadata } from './adm-project-metadata.ts';
import { earOutputChannelCount, isEarLayout, type EarLayout } from './ear/layouts.ts';

export interface EarDeliveryPlan {
	readonly renderer: 'ebu-libear';
	readonly layout: EarLayout;
	readonly channelCount: number;
	readonly sourceChannelCount: number;
	readonly metadata: AdmAuthoredMetadata;
}

export function resolveEarDelivery(
	adm: unknown,
	options: Readonly<{ earLayout?: unknown; mode: string; format: string; binaural?: unknown }>,
): EarDeliveryPlan | null {
	if (options.earLayout == null || options.earLayout === '') return null;
	if (!isEarLayout(options.earLayout)) throw new RangeError('The EBU EAR output layout is unsupported.');
	if (options.mode !== 'mix' || options.format === 'bw64' || options.binaural === true) {
		throw new Error('EBU EAR requires a mixed speaker delivery, without ADM passthrough or headphone rendering.');
	}
	if (!adm || typeof adm !== 'object' || Reflect.get(adm, 'mode') !== 'authored') {
		throw new Error('EBU EAR requires an authored ADM programme.');
	}
	const metadata = normalizeAdmProjectMetadata(adm as AdmAuthoredMetadata) as AdmAuthoredMetadata;
	return Object.freeze({ renderer: 'ebu-libear', layout: options.earLayout,
		channelCount: earOutputChannelCount(options.earLayout)!,
		sourceChannelCount: authoredAdmDeliveryChannelCount(metadata), metadata });
}
