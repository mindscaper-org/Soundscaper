/* SPDX-License-Identifier: AGPL-3.0-only */

import { productionStripMeterIndex } from './production-strip-meter-index.ts';
import type { StripMeterSnapshot } from '../production-audio/strip-meter-session.ts';

export interface ScalarMeterSnapshot {
	readonly dbfs?: number;
	readonly peak?: number;
}

export type MeterScope = 'track' | 'group' | 'send' | 'master';
export type ChannelMeterSource = StripMeterSnapshot | ScalarMeterSnapshot | undefined;

export function productionStripMeter(
	meters: readonly StripMeterSnapshot[] | undefined,
	scope: MeterScope,
	targetId: string,
): StripMeterSnapshot | undefined {
	const index = meters && productionStripMeterIndex(meters);
	if (index) return scope === 'master' ? index.master : (scope === 'track' ? index.tracks : index.nodes).get(targetId);
	return meters?.find(({ strip }) => scope === 'master'
		? strip.kind === 'master'
		: strip.kind === (scope === 'track' ? 'track' : 'mixer-node') && strip.id === targetId);
}

export function meterChannelReadings(meter: ChannelMeterSource): readonly Readonly<{ level: number; clipped: boolean }>[] {
	if (meter && 'channels' in meter && meter.channels.length > 0) {
		const firstPeak = meter.channels[0]!.peak;
		const first = channelReading(20 * Math.log10(firstPeak), firstPeak);
		const secondPeak = meter.channels[1]?.peak;
		return [first, meter.channels.length === 1 ? first : channelReading(20 * Math.log10(secondPeak!), secondPeak)];
	}
	const scalar = meter && !('channels' in meter) ? meter : undefined;
	const reading = channelReading(Number(scalar?.dbfs), scalar?.peak);
	return [reading, reading];
}

function channelReading(db: number, peak?: number): Readonly<{ level: number; clipped: boolean }> {
	return {
		level: Number.isFinite(db) ? Math.max(0, Math.min(100, (db + 60) / 60 * 100)) : 0,
		clipped: peak === undefined ? Number.isFinite(db) && db >= 0 : peak >= 1,
	};
}

/** Compare raw sampled inputs first; changed or differently shaped inputs retain exact display parity. */
export function sameMeterChannelDisplay(left: ChannelMeterSource, right: ChannelMeterSource): boolean {
	if (left && right && 'channels' in left && 'channels' in right && left.channels.length && right.channels.length) {
		const leftFirst = left.channels[0]!.peak, rightFirst = right.channels[0]!.peak;
		const leftSecond = left.channels.length === 1 ? leftFirst : left.channels[1]!.peak;
		const rightSecond = right.channels.length === 1 ? rightFirst : right.channels[1]!.peak;
		if (leftFirst === rightFirst && leftSecond === rightSecond) return true;
	} else if ((!left || !('channels' in left)) && (!right || !('channels' in right))
		&& Number(left?.dbfs) === Number(right?.dbfs) && left?.peak === right?.peak) return true;
	const previous = meterChannelReadings(left), next = meterChannelReadings(right);
	return previous.every((reading, index) => reading.level === next[index]?.level && reading.clipped === next[index]?.clipped);
}
