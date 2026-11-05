/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortableRead } from '../../../../foundation/abort-race.ts';
import type { EngineAudioContext } from '../../../engine/public-api.ts';
import type { EngineRealtimeContextLease } from '../../../engine/realtime-context-custody.ts';
import { observeSoundscaperNativeAudioOutputs, soundscaperNativeAudioDestination } from '../../../soundscaper-native-audio-renderer.ts';

export interface NativePreviewEngine {
	getAudioContext?(options: Readonly<{ resume: boolean }>): Promise<EngineAudioContext>;
	setOutputDevice?(deviceId: string): unknown;
	getState?(): Readonly<{ state: string }>;
	pause?(): unknown;
	stop?(): unknown;
}
export interface NativePreviewEnginePort<Args extends readonly unknown[], Engine extends NativePreviewEngine> {
	getAudioContext(): Promise<EngineAudioContext>;
	createEngine(lease: EngineRealtimeContextLease, ...args: Args): Engine;
}

/** Share only the native clock/output, leaving each audition's graph and gain independent. */
export function createNativePreviewOutput<Engine extends NativePreviewEngine>(
	createEngine: (lease: EngineRealtimeContextLease) => Engine,
	getMainContext: () => Promise<EngineAudioContext>,
	onChange: () => void,
) {
	let current: EngineAudioContext | null = null;
	let destination: AudioNode | null = null;
	let releaseContextListener = () => {};
	const engine = createEngine({ current: () => current });
	const unsubscribe = observeSoundscaperNativeAudioOutputs(context => { if (context === current) onChange(); });
	return Object.freeze({
		engine,
		needsGraphRestart: (deviceId: string) => deviceId.startsWith('native:') || current !== null,
		async route(deviceId: string, signal: AbortSignal): Promise<void> {
			if (!deviceId.startsWith('native:')) {
				const borrowed = current !== null;
				current = null; destination = null;
				releaseContextListener(); releaseContextListener = () => {};
				if (borrowed) await engine.getAudioContext?.({ resume: false });
				signal.throwIfAborted();
				await engine.setOutputDevice?.(deviceId);
				return;
			}
			// Clear the private browser preference before lending the native context;
			// an audition must never apply setSinkId to its owner's context.
			if (!current) await engine.setOutputDevice?.('');
			for (;;) {
				const context = await raceAbortableRead(getMainContext, signal, 'immediate');
				const output = soundscaperNativeAudioDestination(context, context.destination);
				if (context.state !== 'closed' && output !== context.destination) {
					if (current !== context || destination !== output) {
						releaseContextListener();
						current = context; destination = output;
						const changed = () => { if (context.state === 'closed') onChange(); };
						context.addEventListener?.('statechange', changed);
						releaseContextListener = () => context.removeEventListener?.('statechange', changed);
					}
					await engine.getAudioContext?.({ resume: false });
					signal.throwIfAborted();
					return;
				}
				await waitForOutputChange(signal);
			}
		},
		dispose(): void { unsubscribe(); releaseContextListener(); current = null; destination = null; },
	});
}

function waitForOutputChange(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => { unsubscribe(); signal.removeEventListener('abort', abort); };
		const abort = () => { cleanup(); reject(signal.reason); };
		const unsubscribe = observeSoundscaperNativeAudioOutputs(() => { cleanup(); resolve(); });
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
	});
}
