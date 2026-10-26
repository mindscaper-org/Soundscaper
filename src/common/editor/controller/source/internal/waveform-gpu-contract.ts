/* SPDX-License-Identifier: AGPL-3.0-only */
import type { SummaryWaveformChannel } from '../../../design-system-adapters/types.ts';

export interface WaveformGpuPlan {
	readonly mode?: string;
	readonly channels: readonly SummaryWaveformChannel[];
}

export interface WaveformGpuGeometryOptions {
	readonly channel: number;
	readonly width: number;
	readonly centerY: number;
	readonly maxAmplitude: number;
	readonly pixelRatioX: number;
	readonly pixelRatioY: number;
	readonly channelTop: number;
	readonly channelHeight: number;
	readonly showRms: boolean;
	readonly halfWave?: boolean;
	readonly amplitudeScale?: 'linear' | 'db';
	readonly envelopeGain?: (x: number, columnCount: number) => number;
}

export interface WaveformGpuDrawOptions extends WaveformGpuGeometryOptions {
	readonly baseSampleColor: string;
	readonly selectedSampleColor: string;
	readonly baseRmsColor: string;
	readonly selectedRmsColor: string;
	readonly selectionStart: number;
	readonly selectionEnd: number;
}
