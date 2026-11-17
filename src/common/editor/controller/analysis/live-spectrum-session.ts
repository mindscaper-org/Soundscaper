/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackSpectrumSession } from '../../engine/playback-spectrum.ts';
import type { EffectSpectrumMetadata } from '../../engine/effect-spectrum.ts';
import { createSpectrumPlotProjector } from '../../spectrum-plot-geometry.ts';

export interface LiveSpectrumTrack {
	readonly id: string;
	readonly name: string;
	readonly color: string;
}

interface SpectrumCurveDetails {
	readonly peak: Readonly<{ frequency: number; db: number }> | null;
	readonly trackId?: string;
	readonly name?: string;
	readonly color?: string;
}

export interface SpectrumCurveReport extends SpectrumCurveDetails {
	readonly bins: readonly Readonly<{ frequency: number; db: number }>[];
}

interface LiveSpectrumCurveReport extends SpectrumCurveDetails {
	readonly columns: readonly number[];
}

export interface SpectrumPlotReport extends SpectrumCurveReport {
	readonly size: number;
	readonly sampleRate: number;
	readonly tracks?: readonly SpectrumCurveReport[];
}

export interface LivePlaybackSpectrumReport extends LiveSpectrumCurveReport {
	readonly type: 'spectrum';
	readonly scope: 'master';
	readonly live: true;
	readonly size: number;
	readonly sampleRate: number;
	readonly positionFrame: number;
	readonly tracks: readonly LiveSpectrumCurveReport[];
}

/** Debounce range edits and suppress replies after the range or visible owner changes. */
export function observeSelectedSpectrum(dependencies: {
	analyze(): Promise<unknown>;
	publish(report: SpectrumPlotReport): void;
	schedule(analyze: () => void): () => void;
	onError(error: unknown): void;
}): () => void {
	let disposed = false;
	const cancel = dependencies.schedule(() => {
		void Promise.resolve().then(() => disposed ? null : dependencies.analyze()).then(value => {
			if (disposed) return;
			if (!value || typeof value !== 'object' || !('bins' in value) || !Array.isArray(value.bins)
				|| !('size' in value) || !('sampleRate' in value)) throw new TypeError('The spectrum report is unavailable.');
			dependencies.publish(value as SpectrumPlotReport);
		}).catch((error: unknown) => { if (!disposed) dependencies.onError(error); });
	});
	return () => { if (!disposed) { disposed = true; cancel(); } };
}

interface LiveSpectrumDependencies {
	acquire(): PlaybackSpectrumSession;
	readonly tracks: readonly LiveSpectrumTrack[];
	position(): number;
	publish(report: LivePlaybackSpectrumReport | null): void;
	schedule(sample: () => void): () => void;
	onError(error: unknown): void;
}

/** Poll bounded FFT buffers only while the plot is mounted; never render offline PCM. */
export function observeLivePlaybackSpectrum(dependencies: LiveSpectrumDependencies): () => void {
	const session = dependencies.acquire();
	const values = new Float32Array(session.fftSize / 2);
	const projectColumns = createSpectrumPlotProjector(values.length);
	let disposed = false;
	let cancel = () => {};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		cancel();
		session.release();
	};
	const sample = () => {
		if (disposed) return;
		try {
			const metadata = session.read(null, values);
			if (!metadata) { dependencies.publish(null); return; }
			const master = spectrumCurve(values, metadata, projectColumns);
			const tracks = dependencies.tracks.map(track => {
				const reading = session.read(track.id, values);
				return Object.freeze({ ...spectrumCurve(values, reading ?? metadata, projectColumns), trackId: track.id, name: track.name, color: track.color });
			});
			dependencies.publish(Object.freeze({ ...master, type: 'spectrum', scope: 'master', live: true,
				size: metadata.fftSize, sampleRate: metadata.sampleRate, positionFrame: dependencies.position(), tracks: Object.freeze(tracks) }));
		} catch (error) { dispose(); dependencies.onError(error); }
	};
	try { cancel = dependencies.schedule(sample); sample(); }
	catch (error) { dispose(); throw error; }
	return dispose;
}

function spectrumCurve(values: Float32Array, metadata: EffectSpectrumMetadata,
	projectColumns: ReturnType<typeof createSpectrumPlotProjector>): LiveSpectrumCurveReport {
	let peakDb = -120, peakBin = -1;
	for (let bin = 0; bin < values.length; bin++) {
		const value = values[bin]!;
		const db = Number.isFinite(value) ? Math.min(0, value) : -120;
		if (db > peakDb) { peakDb = db; peakBin = bin; }
	}
	const peak = peakBin < 0 ? null : Object.freeze({ frequency: peakBin * metadata.sampleRate / metadata.fftSize, db: peakDb });
	return Object.freeze({ columns: Object.freeze(projectColumns(bin => values[bin]!)), peak });
}
