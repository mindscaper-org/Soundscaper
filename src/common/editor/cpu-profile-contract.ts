/* SPDX-License-Identifier: AGPL-3.0-only */

export const CPU_PROFILE_CHANNEL = 'scape:v1:cpu-profile:capture';
export const CPU_PROFILE_CANCEL_CHANNEL = 'scape:v1:cpu-profile:cancel';
export const CPU_PROFILE_PREFIX = 'scape-cpu:';

export interface CpuEffectReading {
	readonly key: string;
	readonly cpuPercent: number | null;
	readonly elapsedPercent: number;
	readonly calls: number;
}

export interface CpuProfileReading {
	readonly durationMs: number;
	readonly editorCpuPercent: number | null;
	readonly effects: readonly CpuEffectReading[];
}

export interface CpuProfilerBridge {
	capture(): Promise<CpuProfileReading>;
	cancel(): Promise<void>;
}
