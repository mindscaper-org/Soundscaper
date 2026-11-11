/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readMidiTrack, type MidiInstrument } from '../../midi-model.ts';
import { normalizeMidiNativeInstrument, type MidiNativeInstrument } from '../../midi-native-instrument.ts';
import { registerMidiInstrumentProvider } from '../../engine/midi-audio-renderer.ts';
import { acceptNativeMidiPort, createNativeMidiRpc, expectNativeMidiPort } from '../../native-midi-port.ts';
import type { NativePluginInstanceProjectionV1, NativePluginProjectStateV1, NativePluginRegistryView, SoundscaperNativePluginHostBridgeV1 } from '../../native-plugin-host-contract.ts';
type SoundscaperNativeServicesBridge = SoundscaperNativePluginHostBridgeV1 & { listNativePlugins(): Promise<NativePluginRegistryView> };

interface MidiController {
	readonly project?: unknown;
	getSnapshot(): Readonly<{ selectedTrackId?: string | null }>;
	readonly actions: { readonly midi?: { setInstrument(trackId: string, instrument: MidiInstrument): Promise<unknown> } };
}
interface Options {
	readonly bridge: SoundscaperNativeServicesBridge;
	readonly controller?: MidiController | null;
	readonly windowValue?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}
interface Core { readonly bridge: SoundscaperNativeServicesBridge; dispose(): Promise<void> }
interface Session { readonly instance: NativePluginInstanceProjectionV1; readonly rpc: ReturnType<typeof createNativeMidiRpc>; close(): Promise<void> }

/** Instruments use isolated source renders; existing rack effects keep their realtime lifecycle. */
export function withSoundscaperNativeMidiBridge<T extends Core>(options: Options, core: T): T {
	const raw = options.bridge, controller = options.controller;
	const sessions = new Map<string, Session>();
	const failedOpenIds = new Set<string>();
	const assignments = new Map<string, { trackId: string; projectId: unknown; instrument: MidiNativeInstrument }>();
	const windowValue = options.windowValue ?? (typeof window === 'undefined' ? null : window);
	let closing = false;
	let disposal: Promise<void> | null = null;
	const openings = new Set<Promise<Session>>();
	const receive = (event: Event) => {
		const message = event as MessageEvent<{ type?: string; offer?: unknown }>;
		if (message.source !== windowValue || message.data?.type !== 'soundscaper-native-plugin-rpc-port-v1') return;
		acceptNativeMidiPort(message.data.offer, Array.from(message.ports));
	};
	windowValue?.addEventListener('message', receive);
	const unregister = registerMidiInstrumentProvider(async (instrument, sampleRate) => {
		const session = await open(installationId(instrument), sampleRate);
		try {
			if (session.instance.format !== instrument.format || session.instance.stablePluginId !== instrument.stablePluginId
				|| session.instance.binarySha256 !== instrument.binarySha256) throw new Error('The native instrument identity changed.');
			if (instrument.state) await session.rpc.request('load-state', { bytes: decodeState(instrument.state) });
			const topology = await session.rpc.request('topology');
			const inputs = bounded(topology.inputChannels, 0, 32), outputs = bounded(topology.outputChannels, 1, 32);
			return { channelCount: outputs, latencyFrames: session.instance.latencySamples,
				async process(frames, events) {
					const answer = await session.rpc.request('process-midi', { frameCount: frames, events,
						input: Array.from({ length: inputs }, () => new Float32Array(frames)),
						output: Array.from({ length: outputs }, () => new Float32Array(frames)) });
					if (answer.reportedLatencyFrames !== session.instance.latencySamples) throw new Error('Native instrument latency changed during rendering.');
					return answer.output as Float32Array<ArrayBuffer>[];
				}, close: () => session.close() };
		} catch (error) { await session.close(); throw error; }
	});
	const bridge: SoundscaperNativeServicesBridge = { ...core.bridge,
		async instantiateNativePlugin(request) {
			if (typeof raw.listNativePlugins !== 'function') return core.bridge.instantiateNativePlugin(request);
			const trackId = controller?.getSnapshot().selectedTrackId;
			const project = controller?.project as { id?: unknown; sampleRate?: number; tracks?: readonly { id: string }[] } | undefined;
			const registry = await raw.listNativePlugins();
			if (controller?.project !== project || controller?.getSnapshot().selectedTrackId !== trackId) throw new Error('The native plug-in selection changed.');
			const entry = registry.entries.find(entry => entry.installations.some(item => item.installationId === request.installationId));
			if (entry?.classification !== 'instrument') return core.bridge.instantiateNativePlugin(request);
			const track = project?.tracks?.find(track => track.id === trackId);
			if (!trackId || !readMidiTrack(track) || !controller?.actions.midi) throw new Error('Select a MIDI track before assigning a native instrument.');
			const session = await open(request.installationId, project?.sampleRate ?? 48_000);
			try {
				const old = readMidiTrack(track)?.instrument;
				if (old && typeof old !== 'string' && old.binarySha256 === session.instance.binarySha256
					&& old.stablePluginId === session.instance.stablePluginId && old.state) await session.rpc.request('load-state', { bytes: decodeState(old.state) });
				const state = await session.rpc.request('save-state');
				const instrument = normalizeMidiNativeInstrument({ kind: 'native', ...session.instance, name: entry.name, state: encodeState(state.bytes) });
				if (closing || controller.project !== project) throw new Error('The project changed before instrument assignment.');
				await controller.actions.midi.setInstrument(trackId, instrument);
				assignments.set(session.instance.instanceId, { trackId, projectId: project?.id, instrument });
				return { ...session.instance, classification: 'instrument' };
			} catch (error) { await session.close(); throw error; }
		},
		async persistNativePluginState(request) {
			const assignment = assignments.get(request.instanceId);
			if (!assignment) return core.bridge.persistNativePluginState(request);
			const state = await sessions.get(request.instanceId)!.rpc.request('save-state');
			const persisted = await (raw.persistNativePluginState as (request: unknown) => ReturnType<typeof raw.persistNativePluginState>)({ ...request, ...state });
			await updateAssignment(request.instanceId, encodeState(state.bytes));
			return persisted;
		},
		async restoreNativePluginState(request) {
			if (!assignments.has(request.instanceId)) return core.bridge.restoreNativePluginState(request);
			const restored = await raw.restoreNativePluginState(request) as unknown as { projectState: NativePluginProjectStateV1; bytes: Uint8Array };
			await sessions.get(request.instanceId)!.rpc.request('load-state', { bytes: restored.bytes });
			await updateAssignment(request.instanceId, encodeState(restored.bytes));
			return { projectState: restored.projectState };
		},
		async closeNativePluginInstance(request) {
			const session = sessions.get(request.instanceId);
			if (!session) return core.bridge.closeNativePluginInstance(request);
			await session.close(); assignments.delete(request.instanceId); return true;
		},
	};
	return { ...core, bridge: { ...core.bridge, ...bridge }, dispose() {
		if (disposal) return disposal;
		closing = true; unregister();
		disposal = (async () => {
			await Promise.allSettled([...openings]);
			const results = await Promise.allSettled([...sessions.values()].map(session => session.close()).concat([...failedOpenIds].map(closeFailedOpen)));
			windowValue?.removeEventListener('message', receive);
			await core.dispose();
			const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (failures.length) throw new AggregateError(failures, 'Native instrument cleanup failed.');
		})();
		const pending = disposal;
		void pending.catch(() => { if (disposal === pending) disposal = null; });
		return pending;
	} };

	function open(installationId: string, sampleRate: number): Promise<Session> {
		const pending = openSession(installationId, sampleRate);
		openings.add(pending);
		void pending.then(() => { openings.delete(pending); }, () => { openings.delete(pending); });
		return pending;
	}

	async function openSession(installationId: string, sampleRate: number): Promise<Session> {
		if (closing) throw new Error('Native instrument runtime is closing.');
		const instanceId = `midi-instrument-${crypto.randomUUID()}`;
		const offer = expectNativeMidiPort(instanceId);
		let openedRpc: ReturnType<typeof createNativeMidiRpc> | null = null;
		try {
			const opened = await raw.instantiateNativePlugin({ installationId, instanceId, sampleRate });
			if (opened.instanceId !== instanceId) throw new Error('The native instrument instance identity changed.');
			const rpc = createNativeMidiRpc(instanceId, await offer.promise); openedRpc = rpc;
			const latency = await rpc.request('latency');
			const instance = { ...opened, latencySamples: bounded(latency.reportedLatencyFrames, 0, 1_048_576) };
			const session = { instance, rpc, async close() {
				if (!sessions.has(instanceId)) return;
				await raw.closeNativePluginInstance({ instanceId }); rpc.close(); sessions.delete(instanceId);
			} };
			if (closing) throw new Error('Native instrument runtime is closing.');
			sessions.set(instanceId, session); return session;
		} catch (error) {
			openedRpc?.close(); offer.cancel(); failedOpenIds.add(instanceId);
			await closeFailedOpen(instanceId).catch(() => undefined); throw error;
		}
	}
	async function closeFailedOpen(instanceId: string): Promise<void> {
		await raw.closeNativePluginInstance({ instanceId }); failedOpenIds.delete(instanceId);
	}
	async function updateAssignment(instanceId: string, state: string): Promise<void> {
		const assignment = assignments.get(instanceId)!;
		const project = controller?.project as { id?: unknown; tracks?: readonly { id: string }[] } | undefined;
		const current = readMidiTrack(project?.tracks?.find(track => track.id === assignment.trackId))?.instrument;
		if (project?.id !== assignment.projectId || !current || typeof current === 'string'
			|| JSON.stringify(current) !== JSON.stringify(assignment.instrument)) throw new Error('The native instrument assignment changed.');
		const instrument = { ...assignment.instrument, state };
		await controller?.actions.midi?.setInstrument(assignment.trackId, instrument);
		assignment.instrument = instrument;
	}
}

function bounded(value: unknown, minimum: number, maximum: number): number {
	if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new RangeError('Unsupported native instrument channel topology.');
	return Number(value);
}
function encodeState(value: unknown): string {
	if (!(value instanceof Uint8Array) || value.byteLength > 12 * 1024 * 1024) throw new RangeError('Native MIDI instrument state exceeds 12 MiB.');
	let text = '';
	for (let offset = 0; offset < value.length; offset += 8192) text += String.fromCharCode(...value.subarray(offset, offset + 8192));
	return btoa(text);
}
function decodeState(value: string): Uint8Array { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
export function installationId(instrument: Pick<MidiNativeInstrument, 'binarySha256' | 'stablePluginId'>): string {
	return `i${bytesToHex(sha256(new TextEncoder().encode(`${instrument.binarySha256}\0${instrument.stablePluginId}`))).slice(0, 15)}`;
}
