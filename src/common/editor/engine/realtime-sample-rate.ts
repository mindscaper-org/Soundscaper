/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasNativePluginRealtimeContext } from '../native-plugin-realtime-node.js';
import { disposePlaybackFrequencyOutput } from './playback-frequency-range.ts';
import { ENGINE_ASSERT_ACTIVE } from './runtime-symbols.ts';
import { hasRealtimeContextBorrowers } from './realtime-context-custody.ts';
import type { EngineAudioContext } from './public-api.ts';
import type { EngineRealtimeContextFactory, EngineRuntimeHost } from './runtime-types.ts';

const sampleRates = new WeakMap<EngineRuntimeHost, number>();
const automaticAttempts = new WeakMap<EngineAudioContext, number>();

export function realtimeSampleRate(engine: EngineRuntimeHost): number | undefined {
	return sampleRates.get(engine);
}

function automaticProjectRate(engine: EngineRuntimeHost): number | undefined {
	const rate = engine.project?.sampleRate;
	return Number.isSafeInteger(rate) && Number(rate) >= 8_000 && Number(rate) <= 768_000 ? rate : undefined;
}

/** An automatic context follows its project, without pinning a future project's clock. */
export function createEngineRealtimeContext(engine: EngineRuntimeHost, factory: EngineRealtimeContextFactory): EngineAudioContext {
	const explicit = sampleRates.get(engine);
	const automatic = explicit === undefined ? automaticProjectRate(engine) : undefined;
	let context: EngineAudioContext;
	try { context = createRealtimeContext(factory, explicit ?? automatic); }
	catch (error) {
		if (automatic === undefined || !(error instanceof DOMException) || error.name !== 'NotSupportedError') throw error;
		// Some devices cannot create every admitted project rate. Preserve native
		// fallback and the graph's truthful processor admission at its actual rate.
		context = createRealtimeContext(factory);
	}
	if (automatic !== undefined) automaticAttempts.set(context, automatic);
	return context;
}

/** Idle project replacement may retire an old automatic clock. Active input or
 * native plug-in owners retain their explicitly selected or attached context.
 */
export async function prepareAutomaticRealtimeSampleRate(engine: EngineRuntimeHost): Promise<void> {
	if (sampleRates.has(engine)) return;
	const rate = automaticProjectRate(engine), previous = engine.context;
	if (!previous || rate === undefined || previous.sampleRate === rate || automaticAttempts.get(previous) === rate) return;
	if (engine.state === 'playing' || engine.graph || hasNativePluginRealtimeContext(previous) || hasRealtimeContextBorrowers(previous)) return;
	await retireRealtimeContext(engine, previous);
	engine[ENGINE_ASSERT_ACTIVE]();
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
		sampleRates.set(engine, sampleRate);
		await retireRealtimeContext(engine, previous);
		engine[ENGINE_ASSERT_ACTIVE]();
	}
	if (!previous || previous.sampleRate === sampleRate) sampleRates.set(engine, sampleRate);
}

async function retireRealtimeContext(engine: EngineRuntimeHost, previous: EngineAudioContext): Promise<void> {
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
	engine.context = null;
	engine.activeOutputDeviceId = '';
	if (previous.state !== 'closed') await previous.close?.();
}

export function createRealtimeContext(factory: EngineRealtimeContextFactory, sampleRate?: number): EngineAudioContext {
	const Constructor = factory as new(options?: AudioContextOptions) => EngineAudioContext;
	const create = factory as (options?: AudioContextOptions) => EngineAudioContext;
	if (sampleRate == null) {
		try { return new Constructor(); } catch { return create(); }
	}
	try { return new Constructor({ sampleRate }); } catch (error) {
		try { return create({ sampleRate }); }
		catch (factoryError) { throw error instanceof TypeError ? factoryError : error; }
	}
}
