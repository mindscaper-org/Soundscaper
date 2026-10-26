/* SPDX-License-Identifier: AGPL-3.0-only */

export interface SpectrogramProcessedWindow {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly channels: readonly Float32Array[];
}

/** A private rendered source lease; its reads stay inside the waveform PCM cap. */
export interface SpectrogramProcessedPcm {
	readonly frameCount: number;
	readWindow(startFrame: number, endFrame: number, signal: AbortSignal): Promise<SpectrogramProcessedWindow>;
	dispose(): PromiseLike<void> | void;
}

export type PrepareSpectrogramProcessedPcm = (signal: AbortSignal) => Promise<SpectrogramProcessedPcm>;
