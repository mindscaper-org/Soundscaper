/* SPDX-License-Identifier: AGPL-3.0-only */

import { getTransientNodes, releaseTransientNodes } from './audio-node-utils.ts';
import { createEffectSpectrumBank, PARAMETRIC_EQ_SPECTRUM_FFT_SIZE, readSpectrumChannels,
	type EffectSpectrumMetadata, type SpectrumAnalyserNode } from './effect-spectrum.ts';
import type { ProjectGraph } from './project-graph.ts';
import { canonicalStripRefKey } from '../parameter-address.ts';
import { ENGINE_ASSERT_ACTIVE } from './runtime-symbols.ts';
import type { EngineRuntimeMethodMap } from './runtime-types.ts';

export interface PlaybackSpectrumSession {
	readonly fftSize: number;
	/** null identifies the master; track IDs identify isolated post-fader outputs. */
	read(trackId: string | null, target: Float32Array): EffectSpectrumMetadata | null;
	release(): void;
}

interface SpectrumTap {
	readonly source: AudioNode;
	readonly nodes: Set<AudioNode>;
	readonly channels: readonly SpectrumAnalyserNode[];
	readonly metadata: EffectSpectrumMetadata;
}

/** A visible plot owns its taps; every read follows the engine's current graph. */
export function createPlaybackSpectrumSession(owner: {
	readonly graph: ProjectGraph | null;
	readonly context: BaseAudioContext | null;
}): PlaybackSpectrumSession {
	const fftSize = PARAMETRIC_EQ_SPECTRUM_FFT_SIZE;
	const taps = new Map<string | null, SpectrumTap>();
	let graph: ProjectGraph | null = null;
	let released = false;
	const releaseGraph = () => {
		if (!graph) return;
		graph.abortController.signal.removeEventListener('abort', releaseGraph);
		for (const tap of taps.values()) releaseTap(graph, tap.source, tap.nodes);
		taps.clear();
		graph = null;
	};
	return {
		fftSize,
		read(trackId, target) {
			if (target.length !== fftSize / 2) throw new RangeError(`Playback spectra require ${String(fftSize / 2)} bins.`);
			target.fill(Number.NEGATIVE_INFINITY);
			if (graph !== owner.graph) releaseGraph();
			const current = owner.graph;
			const context = owner.context;
			if (released || !current || current.abortController.signal.aborted || !context) return null;
			if (!graph) {
				graph = current;
				graph.abortController.signal.addEventListener('abort', releaseGraph, { once: true });
			}
			let tap = taps.get(trackId);
			if (!tap) {
				const source = trackId === null ? graph.masterAnalyser : graph.trackAnalysers.get(trackId);
				if (!source) return null;
				const key = canonicalStripRefKey(trackId === null ? { kind: 'master' } : { kind: 'track', id: trackId });
				const width = graph.productionStripAnalysersV21?.get(key)?.analysers.length ?? 2;
				const nodes = new Set<AudioNode>();
				try {
					const channels = createEffectSpectrumBank(context, source, nodes, width);
					if (!channels.length) { releaseTap(graph, source, nodes); return null; }
					for (const channel of channels) channel.smoothingTimeConstant = 0.4;
					for (const node of nodes) getTransientNodes(graph.nodes).add(node);
					tap = { source, nodes, channels, metadata: Object.freeze({ fftSize, frequencyBinCount: fftSize / 2,
						sampleRate: context.sampleRate, minDecibels: -120, maxDecibels: 0 }) };
					taps.set(trackId, tap);
				} catch (error) { releaseTap(graph, source, nodes); throw error; }
			}
			readSpectrumChannels(tap.channels, target);
			return tap.metadata;
		},
		release() { if (!released) { released = true; releaseGraph(); } },
	};
}

function releaseTap(graph: ProjectGraph, source: AudioNode, nodes: Set<AudioNode>): void {
	for (const node of nodes) {
		try { source.disconnect(node); } catch { /* Only the tap's first node connects to the source. */ }
	}
	releaseTransientNodes(getTransientNodes(graph.nodes), [...nodes]);
}

export const enginePlaybackSpectrumMethods = {
	acquirePlaybackSpectrum() {
		this[ENGINE_ASSERT_ACTIVE]();
		return createPlaybackSpectrumSession(this);
	},
} satisfies EngineRuntimeMethodMap<'acquirePlaybackSpectrum'>;
