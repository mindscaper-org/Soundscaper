/* SPDX-License-Identifier: AGPL-3.0-only */

import { createNativeDeviceIoWorkletNode } from './native-device-io-worklet-node.js';
import {
	createNativeRealtimeClient,
	type NativeRealtimeTransferredPort,
} from './native-realtime-client.ts';
import type { NativeAudioSessionOpenRequestV1 } from './native-audio-session-request-v1.ts';
import { claimSoundscaperNativeAudioCapture } from './soundscaper-native-audio-capture.ts';
import { nativeAudioDeviceId } from './controller/recording/native-audio-inventory.ts';

export const SOUNDSCAPER_NATIVE_AUDIO_PORT_EVENT = 'soundscaper-native-realtime-port-v1';

type EnginePort = Readonly<{
	getAudioContext(options?: Readonly<{ resume?: boolean; sampleRate?: number }>): Promise<AudioContext>;
	getState(): Readonly<{ state: string }>;
	pause(): void;
	play(): Promise<void>;
}>;

type WindowPort = Pick<Window, 'addEventListener' | 'removeEventListener'>;

interface PreparedSession {
	readonly sessionId: string;
	readonly context: AudioContext;
	readonly node: AudioNode;
	readonly client: ReturnType<typeof createNativeRealtimeClient>;
	readonly direction: NativeAudioSessionOpenRequestV1['direction'];
	readonly channelCount: number;
	readonly sink: GainNode;
	readonly capture: Readonly<{ activate(): void; revoke(reason?: string): void }> | null;
	readonly calibrate: (config: Readonly<{ maxFrames: number; timeoutMs: number }>) => Promise<number>;
	readonly attachment: ReturnType<typeof createAttachment>;
}

const ROUTES = new WeakMap<BaseAudioContext, Readonly<{ node: AudioNode; channelCount: number }>>();

/** Live project graphs consult this only for output/duplex sessions. */
export function soundscaperNativeAudioDestination(context: BaseAudioContext, fallback: AudioNode): AudioNode {
	return ROUTES.get(context)?.node ?? fallback;
}

/** The attached output request owns physical width; intermediary GainNodes do not. */
export function soundscaperNativeAudioOutputChannelCount(context: BaseAudioContext): number | null {
	return ROUTES.get(context)?.channelCount ?? null;
}

export function createSoundscaperNativeAudioRenderer(options: Readonly<{
	engine: EnginePort;
	windowValue?: WindowPort | null;
	createNode?: typeof createNativeDeviceIoWorkletNode;
	onTransfer?: (sessionId: string, value: Readonly<{
		framesTransferred: number; lostFrames: number;
	}>) => void;
	onDeviceLoss?: (sessionId: string, reason: string) => Promise<void> | void;
}>) {
	const windowValue = options.windowValue ?? (typeof window === 'undefined' ? null : window);
	const createNode = options.createNode ?? createNativeDeviceIoWorkletNode;
	const prepared = new Map<string, PreparedSession>();
	const expectedPorts: string[] = [];
	let listening = false;
	let disposed = false;
	let preparationGeneration = 0;
	const directionGenerations = new Map<'input' | 'output', number>();
	const preparations = new Set<Promise<void>>();

	const receive = (event: Event): void => {
		const message = event as MessageEvent<unknown>;
		// The preload relay posts to its own window; a message from any other
		// source — an embedded frame above all — must not attach audio
		// authority: an accepted forged offer would route playback into the
		// sender's port and publish its audio into canonical recording.
		const sourceWindow = (windowValue as { window?: Window } | null)?.window
			?? (typeof window === 'undefined' ? null : window);
		if (message.source !== sourceWindow) return;
		const ports = Array.from(message.ports ?? []) as NativeRealtimeTransferredPort[];
		const data = message.data as Readonly<{ type?: unknown; offer?: unknown }> | null;
		if (data?.type !== SOUNDSCAPER_NATIVE_AUDIO_PORT_EVENT) return;
		const offered = data.offer as Readonly<Record<string, unknown>> | null;
		const sessionId = typeof offered?.sessionId === 'string' ? offered.sessionId : null;
		const expectedSessionId = sessionId ?? expectedPorts.shift();
		if (sessionId) {
			const index = expectedPorts.indexOf(sessionId);
			if (index >= 0) expectedPorts.splice(index, 1);
		}
		const session = expectedSessionId ? prepared.get(expectedSessionId)
			: [...prepared.values()].reverse().find((candidate) => candidate.client.generation === 0);
		if (!session) {
			for (const port of ports) close(port);
			return;
		}
		const handshake = sessionId && offered ? Object.fromEntries(Object.entries(offered).filter(([key]) => key !== 'sessionId')) : data.offer;
		const outcome = session.client.receive(handshake, ports);
		if (outcome.status === 'attached') {
			session.capture?.activate();
			session.attachment.resolve();
			if (session.direction !== 'input') {
				ROUTES.set(session.context, Object.freeze({ node: session.node, channelCount: session.channelCount }));
				void restartIfPlaying(options.engine).catch(() => undefined);
			}
		} else session.attachment.reject(new Error(outcome.message));
	};

	const listen = (): void => {
		if (listening || !windowValue) return;
		listening = true;
		windowValue.addEventListener('message', receive);
	};

	const release = async (sessionId?: string): Promise<void> => {
		let outputReleased = false;
		for (const current of [...prepared.values()]) {
			if (sessionId !== undefined && current.sessionId !== sessionId) continue;
			prepared.delete(current.sessionId);
			outputReleased ||= current.direction !== 'input';
			for (let index = expectedPorts.length - 1; index >= 0; index -= 1) {
				if (expectedPorts[index] === current.sessionId) expectedPorts.splice(index, 1);
			}
			if (ROUTES.get(current.context)?.node === current.node) {
				ROUTES.delete(current.context);
				outputReleased = true;
			}
			current.capture?.revoke('session-closed');
			current.attachment.reject(new Error('The native audio device closed before its port was ready.'));
			current.client.dispose();
			try { current.sink.disconnect(); } catch { /* already disconnected */ }
		}
		if (outputReleased) await restartIfPlaying(options.engine);
	};

	const prepare = (sessionId: string, request: NativeAudioSessionOpenRequestV1, route?: Readonly<{
		backend: string; deviceHandle: string;
	}>): Promise<void> => {
		assertOpen();
		const generation = ++preparationGeneration;
		for (const direction of ['input', 'output'] as const) {
			if (request.direction === direction || request.direction === 'duplex') directionGenerations.set(direction, generation);
		}
		const pending = prepareRoute(sessionId, request, route, generation);
		preparations.add(pending);
		const settled = (): void => { preparations.delete(pending); };
		void pending.then(settled, settled);
		return pending;
	};

	async function prepareRoute(
		sessionId: string,
		request: NativeAudioSessionOpenRequestV1,
		route: Readonly<{ backend: string; deviceHandle: string }> | undefined,
		generation: number,
	): Promise<void> {
		for (const current of [...prepared.values()]) {
			if (request.direction === 'duplex' || current.direction === 'duplex' || current.direction === request.direction) {
				await release(current.sessionId);
			}
		}
		assertCurrent(generation, request.direction);
		listen();
		const context = await options.engine.getAudioContext({ resume: true, sampleRate: request.sampleRate });
		assertCurrent(generation, request.direction);
		// The worklet copies frames one-to-one between the engine graph and
		// the native device, so a route at any other rate would repitch
		// playback against the export render and mis-clock capture. The
		// contract forbids silent substitution: the open refuses instead.
		if (context.sampleRate !== request.sampleRate) {
			throw new Error(`The engine audio context runs at ${String(context.sampleRate)} Hz; `
				+ `a native route at ${String(request.sampleRate)} Hz must be opened at the context rate.`);
		}
		let capture: PreparedSession['capture'] = null;
		const lost = (value: Readonly<{ reason?: unknown }>, fallback: string): void => {
			if (!prepared.has(sessionId)) return;
			const reason = nativeAudioLossReason(value.reason, fallback);
			capture?.revoke(String(value.reason || fallback));
			void (async () => {
				try { await options.onDeviceLoss?.(sessionId, reason); }
				finally { await release(sessionId); }
			})().catch(() => undefined);
		};
		const transport = await createNode(context, {
			direction: request.direction,
			channelCount: request.channelCount,
			periodFrames: request.periodFrames,
			queueCapacity: 8,
			onTransfer: (value: Readonly<{ framesTransferred: number; lostFrames: number }>) => {
				if (prepared.has(sessionId)) options.onTransfer?.(sessionId, value);
			},
			onClose: (value: Readonly<{ reason?: unknown }>) => lost(value, 'device-loss'),
			onFault: (value: Readonly<{ reason?: unknown }>) => lost(value, 'device-fault'),
		});
		let sink: GainNode | null = null;
		try {
			assertCurrent(generation, request.direction);
			sink = context.createGain();
			sink.gain.value = 0;
			transport.node.connect(sink);
			sink.connect(context.destination);
			if (request.direction !== 'output') capture = claimSoundscaperNativeAudioCapture({
				sessionId, context, node: transport.node,
				channelCount: request.channelCount, sampleRate: request.sampleRate,
				deviceId: route ? nativeAudioDeviceId(route.backend, 'audio-input', route.deviceHandle) : undefined,
			});
			prepared.set(sessionId, Object.freeze({
				sessionId, context, node: transport.node, direction: request.direction, channelCount: request.channelCount,
				sink, capture, calibrate: transport.calibrate, attachment: createAttachment(),
				client: createNativeRealtimeClient({
					transport,
					request: {
						sampleRate: request.sampleRate, channelCount: request.channelCount,
						frameCount: request.periodFrames, queueCapacity: 8,
					},
				}),
			}));
		} catch (error) {
			capture?.revoke('session-closed');
			try { sink?.disconnect(); } catch { /* partially connected */ }
			transport.dispose();
			throw error;
		}
	}

	function assertOpen(): void {
		if (disposed) throw new Error('The native audio renderer has been disposed.');
	}

	function assertCurrent(generation: number, requestedDirection: NativeAudioSessionOpenRequestV1['direction']): void {
		assertOpen();
		for (const direction of ['input', 'output'] as const) {
			if ((requestedDirection === direction || requestedDirection === 'duplex') && directionGenerations.get(direction) !== generation) {
				throw new Error('The native audio route preparation was superseded.');
			}
		}
	}

	return Object.freeze({
		prepare,
		async waitForPort(sessionId: string): Promise<void> {
			const session = prepared.get(sessionId);
			if (!session) throw new Error('That native audio session is not prepared in this renderer.');
			const timeout = globalThis.setTimeout(() => session.attachment.reject(new Error(
				'The native audio device did not become ready. Refresh audio devices or choose another host.',
			)), 5_000);
			try { await session.attachment.promise; }
			finally { globalThis.clearTimeout(timeout); }
		},
		expectPort(sessionId: string): void {
			const session = prepared.get(sessionId);
			if (!session) throw new Error('That native audio session is not prepared in this renderer.');
			if (session.client.generation === 0 && !expectedPorts.includes(sessionId)) expectedPorts.push(sessionId);
		},
		async calibrate(sessionId: string): Promise<number> {
			const session = prepared.get(sessionId);
			if (!session) {
				throw new Error('That native audio session is not prepared in this renderer.');
			}
			if (session.direction !== 'duplex') throw new Error('Latency calibration requires a duplex route.');
			if (session.client.generation === 0) throw new Error('Latency calibration requires a bound route.');
			return session.calibrate({
				maxFrames: Math.min(1_048_576, Math.round(session.context.sampleRate * 2)),
				timeoutMs: 2_500,
			});
		},
		release,
		async dispose(): Promise<void> {
			disposed = true;
			if (listening) windowValue?.removeEventListener('message', receive);
			listening = false;
			await Promise.allSettled([...preparations]);
			await release();
		},
	});
}

function createAttachment() {
	let resolve: () => void = () => undefined;
	let reject: (error: Error) => void = () => undefined;
	const promise = new Promise<void>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
	void promise.catch(() => undefined);
	return Object.freeze({ promise, resolve, reject });
}

async function restartIfPlaying(engine: EnginePort): Promise<void> {
	if (engine.getState().state !== 'playing') return;
	engine.pause();
	await engine.play();
}

function close(port: NativeRealtimeTransferredPort): void {
	try { port.close(); } catch { /* already transferred */ }
}

const NATIVE_AUDIO_LOSS_REASONS = new Set([
	'device-loss', 'device-fault', 'short-transfer', 'output-overrun',
	'pool-violation', 'peer-loss', 'malformed-message',
]);

function nativeAudioLossReason(value: unknown, fallback: string): string {
	const reason = String(value || fallback);
	return NATIVE_AUDIO_LOSS_REASONS.has(reason) ? reason : 'device-fault';
}
