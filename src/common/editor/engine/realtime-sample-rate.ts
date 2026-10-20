/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasNativePluginRealtimeContext } from '../native-plugin-realtime-node.js';
import { disposePlaybackFrequencyOutput } from './playback-frequency-range.ts';
import { ENGINE_ASSERT_ACTIVE } from './runtime-symbols.ts';
import type { EngineAudioContext } from './public-api.ts';
import type { EngineRealtimeContextFactory, EngineRuntimeHost } from './runtime-types.ts';

const sampleRates = new WeakMap<EngineRuntimeHost, number>();

export function realtimeSampleRate(engine: EngineRuntimeHost): number | undefined {
	return sampleRates.get(engine);
}

/** Native input nodes and the listening graph must share the selected hardware rate. */
export async function prepareRealtimeSampleRate(engine: EngineRuntimeHost, sampleRate?: number): Promise<void> {
	if (sampleRate === undefined) return;
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 768_000) {
		throw new RangeError('Audio sample rate must be an integer between 8000 and 768000 Hz.');
	}
	const previous = engine.context;
	if (previous && previous.sampleRate !== sampleRate) {
		if (engine.state === 'playing' || engine.pendingPlayRequest || engine.scrubbing) {
			throw new Error('Stop playback before changing the audio sample rate.');
		}
		if (hasNativePluginRealtimeContext(previous)) {
			throw new Error('Remove native plug-in effects before changing the audio sample rate, then add them again.');
		}
		engine.masterLoudnessMeter?.dispose();
		engine.masterLoudnessMeter = null;
		engine.masterLoudnessMeterChannelCount = null;
		engine.masterLoudnessMeterChannelWeights = null;
		engine.masterLoudnessMeterPromise = null;
		engine.latestMasterLoudnessMeter = null;
		engine.masterLoudnessMeterError = null;
		disposePlaybackFrequencyOutput(engine);
		engine.playbackOutputNode?.disconnect();
		engine.playbackOutputNode = null;
		engine.playbackOutputDestination = null;
		engine.preparedSpeedPlayback = null;
		engine.preparedAudioWarpPlayback = null;
		engine.audioWarpPlaybackPreparation = null;
		sampleRates.set(engine, sampleRate);
		engine.context = null;
		engine.activeOutputDeviceId = '';
		if (previous.state !== 'closed') await previous.close?.();
		engine[ENGINE_ASSERT_ACTIVE]();
	}
	if (!previous || previous.sampleRate === sampleRate) sampleRates.set(engine, sampleRate);
}

export function createRealtimeContext(factory: EngineRealtimeContextFactory, sampleRate?: number): EngineAudioContext {
	const Constructor = factory as new(options?: AudioContextOptions) => EngineAudioContext;
	const create = factory as (options?: AudioContextOptions) => EngineAudioContext;
	if (sampleRate == null) {
		try { return new Constructor(); } catch { return create(); }
	}
	try { return new Constructor({ sampleRate }); } catch {
		return create({ sampleRate });
	}
}
