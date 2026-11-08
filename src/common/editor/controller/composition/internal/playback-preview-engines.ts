/* SPDX-License-Identifier: AGPL-3.0-only */

import { createNativePreviewOutput, type NativePreviewEngine, type NativePreviewEnginePort } from './native-preview-output.ts';
import type { NormalizedPlayRange } from '../../../engine/buffer-math.ts';

interface ListeningEngine extends NativePreviewEngine {
	setPlaybackGain(gain: number): unknown;
	setOutputDevice?(deviceId: string): unknown;
	play?(): Promise<void>;
	setPlayRange?(range: NormalizedPlayRange | null): NormalizedPlayRange | null;
	dispose(): Promise<void> | void;
}

/** Auditions own their audio contexts, while listening volume and speaker choice belong to the editor. */
export function createPlaybackPreviewEngines<Args extends readonly unknown[], Engine extends ListeningEngine>(
	createEngine: (...args: Args) => Engine,
	getPlaybackGain: () => number,
	getOutputDevice: () => string = () => '',
	nativeOutput?: NativePreviewEnginePort<Args, Engine>,
) {
	const active = new Set<Engine>();
	const outputReady = new Map<Engine, Promise<void>>();
	const controllers = new Map<Engine, AbortController>();
	const nativeRoutes = new Map<Engine, ReturnType<typeof createNativePreviewOutput<Engine>>>();
	const resumes = new Set<Engine>();
	const rawPlay = new Map<Engine, (() => Promise<void>) | undefined>();
	const rawPause = new Map<Engine, (() => unknown) | undefined>();
	const playRequests = new Map<Engine, number>();
	const desiredOutputs = new Map<Engine, string>();
	const playRanges = new Map<Engine, NormalizedPlayRange | null>();
	const routeOutput = (engine: Engine, deviceId: string): Promise<void> => {
		desiredOutputs.set(engine, deviceId);
		controllers.get(engine)?.abort();
		const controller = new AbortController(); controllers.set(engine, controller);
		const browserDeviceId = deviceId.startsWith('native:') ? '' : deviceId;
		const work = (outputReady.get(engine) ?? Promise.resolve()).catch(() => undefined).then(async () => {
			if (!active.has(engine) || controller.signal.aborted) return;
			try {
				const route = nativeRoutes.get(engine);
				if (route?.needsGraphRestart(deviceId)) {
					if (engine.getState?.().state === 'playing') resumes.add(engine);
					rawPause.get(engine)?.();
				}
				if (route) await route.route(deviceId, controller.signal);
				else await engine.setOutputDevice?.(browserDeviceId);
				if (!controller.signal.aborted && resumes.delete(engine)) {
					if (playRanges.has(engine)) engine.setPlayRange?.(playRanges.get(engine) ?? null);
					await rawPlay.get(engine)?.();
				}
			} catch (error) { if (active.has(engine) && !controller.signal.aborted) throw error; }
		});
		outputReady.set(engine, work);
		void work.catch(() => undefined);
		return work;
	};
	const create = (...args: Args): Engine => {
		const native = nativeOutput && createNativePreviewOutput(lease => nativeOutput.createEngine(lease, ...args),
			nativeOutput.getAudioContext, () => { void routeOutput(engine, getOutputDevice()); });
		const engine = native?.engine ?? createEngine(...args);
		if (native) nativeRoutes.set(engine, native);
		engine.setPlaybackGain(getPlaybackGain());
		active.add(engine);
		const play = engine.play?.bind(engine);
		const setPlayRange = engine.setPlayRange?.bind(engine);
		if (native && setPlayRange) engine.setPlayRange = range => {
			const normalized = setPlayRange(range);
			playRanges.set(engine, normalized);
			return normalized;
		};
		rawPlay.set(engine, play); rawPause.set(engine, engine.pause?.bind(engine));
		for (const method of ['pause', 'stop'] as const) {
			const operation = engine[method]?.bind(engine);
			if (operation) engine[method] = () => {
				resumes.delete(engine); playRanges.delete(engine); controllers.get(engine)?.abort();
				playRequests.set(engine, (playRequests.get(engine) ?? 0) + 1);
				return operation();
			};
		}
		void routeOutput(engine, getOutputDevice());
		if (play) engine.play = async () => {
			const request = (playRequests.get(engine) ?? 0) + 1;
			playRequests.set(engine, request);
			void routeOutput(engine, desiredOutputs.get(engine) ?? getOutputDevice());
			let ready: Promise<void> | undefined;
			do { ready = outputReady.get(engine); await ready; }
			while (active.has(engine) && ready !== outputReady.get(engine));
			if (!active.has(engine) || playRequests.get(engine) !== request) return;
			await play();
		};
		const dispose = engine.dispose.bind(engine);
		engine.dispose = () => {
			active.delete(engine);
			controllers.get(engine)?.abort(); controllers.delete(engine);
			nativeRoutes.get(engine)?.dispose(); nativeRoutes.delete(engine);
			resumes.delete(engine); rawPlay.delete(engine); rawPause.delete(engine);
			playRequests.delete(engine); desiredOutputs.delete(engine);
			playRanges.delete(engine);
			outputReady.delete(engine);
			return dispose();
		};
		return engine;
	};
	const setGain = (gain: number): void => {
		for (const engine of active) engine.setPlaybackGain(gain);
	};
	const setOutput = async (deviceId: string): Promise<void> => {
		await Promise.all([...active].map(engine => routeOutput(engine, deviceId)));
	};
	return Object.freeze({ create, setGain, setOutput });
}
