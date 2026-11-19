/* SPDX-License-Identifier: AGPL-3.0-only */
import { EditorProjectGeneration } from '../../src/common/editor/controller/shared/lifecycle.ts';
import type { EnginePublicApi } from '../../src/common/editor/engine/public-api.ts';
import { createDefaultMixerGraphV21 } from '../../src/common/editor/mixer-graph-v21.ts';
import type { NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from '../../src/common/editor/ui/soundscaper-native-services-bridge.ts';

let fixtureSequence = 0;

export function rollbackFixture(options: Readonly<{ seeded?: boolean }> = {}) {
	const suffix = String(++fixtureSequence);
	const authoredInstanceId = `authored-${suffix}`;
	const pluginInstanceId = `plugin-${suffix}`;
	const audioSessionId = `audio-${suffix}`;
	const audio = new Set<string>();
	const plugins = new Set<string>();
	const audioCloses: string[] = [];
	const pluginCloses: string[] = [];
	const pluginBypasses: Array<{ readonly instanceId: string; readonly bypassed: boolean }> = [];
	const listeners = new Set<(event: Event) => void>();
	let audioCloseFailure = false;
	let pluginCloseFailure = false;
	let initialPersistenceRefused = false;
	let delayAudioOpen = false;
	let delayPluginPersistence = false;
	let delayPluginRestore = false;
	let delayPluginBypass = false;
	const audioOpenStarted = deferred();
	const audioOpenGate = deferred();
	const pluginPersistenceStarted = deferred();
	const pluginPersistenceGate = deferred();
	const pluginRestoreStarted = deferred();
	const pluginRestoreGate = deferred();
	const pluginBypassStarted = deferred();
	const pluginBypassGate = deferred();
	const state = pluginState(authoredInstanceId);
	const project = {
		id: `project-a-${suffix}`, sampleRate: 48_000,
		masterChannels: 2,
		tracks: [{
			id: 'track-1', type: 'audio', enabled: true, effectsActive: true,
			effects: options.seeded ? [rackEffect(authoredInstanceId)] : [] as Record<string, unknown>[],
		}, {
			id: 'track-2', type: 'audio', enabled: true, effectsActive: true,
			effects: [] as Record<string, unknown>[],
		}],
		master: { effectsActive: true, effects: [] as Record<string, unknown>[] },
		mixer: createDefaultMixerGraphV21([
			{ id: 'track-1', channelCount: 2 }, { id: 'track-2', channelCount: 2 },
		], 2),
		nativePluginStates: options.seeded ? [state] : [] as ReturnType<typeof pluginState>[],
	};
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const audioContext = {
		sampleRate: 48_000,
		destination: audioNode(),
		audioWorklet: { addModule: async () => undefined },
		createGain: () => ({ ...audioNode(), gain: { value: 1 } }),
	} as unknown as AudioContext;
	const bridge = {
		openNativeAudioSession: async (request: NativeAudioSessionOpenRequestV1) => {
			if (delayAudioOpen) {
				audioOpenStarted.resolve();
				await audioOpenGate.promise;
				delayAudioOpen = false;
			}
			audio.add(audioSessionId);
			return {
				status: 'opened' as const, sessionId: audioSessionId,
				backend: request.candidates[0]!.backend,
				deviceHandle: request.candidates[0]!.deviceHandle,
				format: request, attempts: [],
			};
		},
		closeNativeAudioSession: async ({ sessionId }: Readonly<{ sessionId: string }>) => {
			audioCloses.push(sessionId);
			if (audioCloseFailure) {
				audioCloseFailure = false;
				throw new Error('planned audio close failure');
			}
			return audio.delete(sessionId);
		},
		instantiateNativePlugin: async (request: Readonly<{ instanceId: string | null }>) => {
			const instanceId = request.instanceId ?? pluginInstanceId;
			plugins.add(instanceId);
			queueMicrotask(() => {
				for (const listener of listeners) listener(pluginPortOffer(instanceId));
			});
			return pluginProjection(instanceId);
		},
		setNativePluginBypassed: async (request: { readonly instanceId: string; readonly bypassed: boolean }) => {
			if (delayPluginBypass) { pluginBypassStarted.resolve(); await pluginBypassGate.promise; delayPluginBypass = false; }
			pluginBypasses.push(request);
			return pluginProjection(request.instanceId, { bypassed: request.bypassed });
		},
		persistNativePluginState: async ({ instanceId }: Readonly<{ instanceId: string }>) => {
			if (delayPluginPersistence) {
				pluginPersistenceStarted.resolve();
				await pluginPersistenceGate.promise;
				delayPluginPersistence = false;
			}
			return { outcome: { status: 'persisted' },
				projectState: initialPersistenceRefused ? null : pluginState(instanceId) };
		},
		restoreNativePluginState: async ({ instanceId }: Readonly<{ instanceId: string }>) => {
			if (delayPluginRestore) {
				pluginRestoreStarted.resolve();
				await pluginRestoreGate.promise;
				delayPluginRestore = false;
			}
			return { projectState: pluginState(instanceId), bytes: new Uint8Array([1]) };
		},
		closeNativePluginInstance: async ({ instanceId }: Readonly<{ instanceId: string }>) => {
			pluginCloses.push(instanceId);
			if (pluginCloseFailure) {
				pluginCloseFailure = false;
				throw new Error('planned plug-in close failure');
			}
			return plugins.delete(instanceId);
		},
	} as unknown as SoundscaperNativeServicesBridge;
	const engine = {
		sampleRate: 48_000,
		getAudioContext: async () => audioContext,
		getState: () => ({ state: 'stopped' }),
		getPositionFrames: () => 0,
		commitNativeEffectPdcRevision: () => ({ contextTime: null, publicationDelayMs: 0 }),
		pause() {},
		play: async () => undefined,
	} as unknown as EnginePublicApi;
	let selectedTrackId = 'track-1';
	const controller = {
		project,
		captureProjectGeneration: projectGeneration.capture.bind(projectGeneration),
		assertProjectGeneration: projectGeneration.assertCurrent.bind(projectGeneration),
		getSnapshot: () => ({ selectedTrackId }),
		actions: {
			effects: {
				update(_scope: string, _trackId: string, effectId: string, changes: Record<string, unknown>) {
					const effect = controller.project.tracks[0]!.effects.find(({ id }) => id === effectId);
					if (effect) Object.assign(effect, changes);
				},
			},
			nativePlugins: {
				commitBinding(request: Readonly<{
					operation: 'author' | 'restore'; trackId: string;
					effect: Readonly<Record<string, unknown>>; state: unknown;
				}>) {
					const effectId = typeof request.effect.id === 'string' ? request.effect.id : `effect-${suffix}`;
					const effect = { id: effectId, type: 'native-plugin', ...request.effect };
					if (request.operation === 'author') {
						controller.project.tracks.find(({ id }) => id === request.trackId)?.effects.push(effect);
					}
					controller.project.nativePluginStates = [request.state as ReturnType<typeof pluginState>];
					return { effectId };
				},
				upsert(next: unknown) {
					controller.project.nativePluginStates = [next as ReturnType<typeof pluginState>];
				},
				setBypassed(instanceId: string, bypassed: boolean) {
					controller.project.nativePluginStates = controller.project.nativePluginStates.map(state => state.instanceId === instanceId
						? { ...state, bypassed, continuity: bypassed ? 'bypass' as const : 'live' as const } : state);
				},
			},
		},
	};
	return {
		active: () => ({ audio: [...audio], plugins: [...plugins] }),
		audioCloses, audioContext, bridge, controller, engine, pluginBypasses, pluginCloses, project,
		effect: () => project.tracks[0]!.effects[0] as unknown as {
			bypassed: boolean; params: { latencyFrames: number };
		},
		windowValue: {
			window: FIXTURE_WINDOW_SOURCE,
			addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
				listeners.add(listener as (event: Event) => void);
			},
			removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
				listeners.delete(listener as (event: Event) => void);
			},
		} as Pick<Window, 'addEventListener' | 'removeEventListener'>,
		failNextAudioClose: () => { audioCloseFailure = true; },
		failNextPluginClose: () => { pluginCloseFailure = true; },
		refuseInitialPersistence: () => { initialPersistenceRefused = true; },
		deferNextAudioOpen: () => {
			delayAudioOpen = true;
			return { started: audioOpenStarted.promise, resolve: audioOpenGate.resolve };
		},
		deferNextPluginPersistence: () => {
			delayPluginPersistence = true;
			return { started: pluginPersistenceStarted.promise, resolve: pluginPersistenceGate.resolve };
		},
		deferNextPluginRestore: () => {
			delayPluginRestore = true;
			return { started: pluginRestoreStarted.promise, resolve: pluginRestoreGate.resolve };
		},
		deferNextPluginBypass: () => {
			delayPluginBypass = true;
			return { started: pluginBypassStarted.promise, resolve: pluginBypassGate.resolve };
		},
		selectTrack: (trackId: string) => { selectedTrackId = trackId; },
		retireProject: () => projectGeneration.invalidate(),
		switchProject: (preserveNativeState = false) => {
			projectGeneration.invalidate();
			const replacement = {
				...project, id: `project-b-${suffix}`,
				tracks: [{ ...project.tracks[0]!, id: 'track-b',
					effects: preserveNativeState ? [...project.tracks[0]!.effects] : [] as Record<string, unknown>[] }],
				mixer: createDefaultMixerGraphV21([{ id: 'track-b', channelCount: 2 }], 2),
				nativePluginStates: preserveNativeState
					? [...project.nativePluginStates] : [] as ReturnType<typeof pluginState>[],
			};
			controller.project = replacement;
			projectGeneration.activate(replacement.id);
			selectedTrackId = 'track-b';
			return replacement;
		},
	};
}

export function useFakeAudioWorklet(context: Readonly<{ after(callback: () => void): void }>) {
	const original = globalThis.AudioWorkletNode;
	const nodes: FakeAudioWorkletNode[] = [];
	class FakeAudioWorkletNode {
		readonly name: string;
		readonly port = {
			onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
			posted: [] as Record<string, unknown>[],
			start() {},
			postMessage: (message: Record<string, unknown>) => {
				this.port.posted.push(message);
				if (message.type === 'native-plugin-attach') queueMicrotask(() => this.port.onmessage?.({
					data: { type: 'native-plugin-attached', generation: 1 },
				}));
				if (message.type === 'native-plugin-save-state') queueMicrotask(() => this.port.onmessage?.({
					data: {
						type: 'native-plugin-state', requestId: message.requestId,
						bytes: new Uint8Array([1]), authentication: { status: 'authenticated' },
					},
				}));
				if (message.type === 'native-plugin-load-state') queueMicrotask(() => this.port.onmessage?.({
					data: { type: 'native-plugin-state-loaded', requestId: message.requestId },
				}));
			},
		};
		constructor(_context: unknown, name: string) { this.name = name; nodes.push(this); }
		connect(): void {}
		disconnect(): void {}
	}
	globalThis.AudioWorkletNode = FakeAudioWorkletNode as unknown as typeof AudioWorkletNode;
	context.after(() => { globalThis.AudioWorkletNode = original; });
	return {
		faultPlugin() {
			const node = nodes.find(({ name }) => name === 'soundscaper-native-plugin-v1');
			node?.port.onmessage?.({ data: { type: 'native-plugin-fault', reason: 'test fault' } });
		},
		bypassMessages: () => nodes.find(({ name }) => name === 'soundscaper-native-plugin-v1')
			?.port.posted.filter(({ type }) => type === 'native-plugin-bypass') ?? [],
	};
}

const FIXTURE_WINDOW_SOURCE = {} as Window;

function pluginPortOffer(instanceId: string): Event {
	return {
		source: FIXTURE_WINDOW_SOURCE,
		data: { type: 'soundscaper-native-plugin-rpc-port-v1', offer: {
			instanceId, purpose: 'plugin-rpc', transport: 'message-port',
			portContractVersion: 1, generation: 1, reportedLatencyFrames: 0,
		} },
		ports: [{ postMessage() {}, close() {} }],
	} as unknown as Event;
}

export function audioRequest(): NativeAudioSessionOpenRequestV1 {
	return {
		candidates: [{ backend: 'alsa', deviceHandle: 'device-1' }],
		direction: 'output', mode: 'shared', sampleRate: 48_000,
		periodFrames: 128, channelCount: 2,
	};
}

function audioNode(): AudioNode {
	return { connect() {}, disconnect() {} } as unknown as AudioNode;
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
	let settle = (): void => undefined;
	const promise = new Promise<void>((resolve) => { settle = resolve; });
	return Object.freeze({ promise, resolve: () => settle() });
}

export function isProjectOwnershipLoss(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError' && /project changed/iu.test(error.message);
}

function pluginProjection(instanceId: string, overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		instanceId, entryId: 'entry-1', stablePluginId: 'org.example.effect', format: 'clap' as const,
		binarySha256: 'a'.repeat(64), inputChannels: 2, outputChannels: 2,
		state: 'hosted' as const, enabled: true, bypassed: false, latencySamples: 0, ...overrides,
	};
}

export function pluginState(instanceId: string, bypassed = false) {
	return {
		instanceId, format: 'clap' as const, stablePluginId: 'org.example.effect',
		binarySha256: 'a'.repeat(64), enabled: true, bypassed, continuity: bypassed ? 'bypass' as const : 'live' as const,
		stateBody: {
			kind: 'native-plugin-state' as const, bodyId: 'b'.repeat(64),
			byteLength: 1, sha256: 'c'.repeat(64),
		},
	};
}

function rackEffect(instanceId: string): Record<string, unknown> {
	return {
		id: `effect-${instanceId}`, type: 'native-plugin', enabled: true, bypassed: false,
		params: { instanceId, latencyFrames: 0 },
		context: {
			format: 'clap', stablePluginId: 'org.example.effect', binarySha256: 'a'.repeat(64),
		},
	};
}
