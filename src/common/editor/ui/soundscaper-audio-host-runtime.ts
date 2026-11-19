/* SPDX-License-Identifier: AGPL-3.0-only */

import { AudioHostError, audioHostOperation, type AudioHostFailureCode } from './audio-host-failure.ts';
import { nativeAudioDeviceId, type NativeAudioDeviceDefaults, type NativeAudioDeviceReport, type NativeAudioInventoryReport } from '../controller/recording/native-audio-inventory.ts';
import { createNativeAudioRouteOpenRequest, isNativeAudioStreamingBackend, nativeAudioInputChannelDemand } from './soundscaper-native-audio-route.ts';
import type { NativeAudioAvailability, NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from './soundscaper-native-services-bridge.ts';
import type { MicrophoneMeterInputReplacement } from '../controller/recording/microphone-meter-service.ts';

interface AudioHostPreferences {
	readonly inputAccess?: boolean;
	readonly host: string;
	readonly recordingSampleRate: number;
	readonly preferredInputDeviceId: string;
	readonly preferredOutputDeviceId: string;
	readonly preferredInputChannelCount: number;
}

export interface SoundscaperAudioHostController {
	getSnapshot(): Readonly<{ audioDevices: AudioHostPreferences & Readonly<{ inputAccess?: boolean }>; recording?: boolean;
		recordingStarting?: boolean; recordingFinishing?: boolean; recordingScheduling?: boolean; scheduledRecording?: unknown;
		recordingInputs?: Readonly<{ routes: unknown }> }>;
	subscribe(listener: () => void): () => void;
	readonly actions: Readonly<{ audioDevices: Readonly<{
		setHostInventory(host: string, inventory: NativeAudioInventoryReport | null, defaults?: NativeAudioDeviceDefaults): Promise<unknown>;
		requestAccess(): Promise<unknown>;
	}>; recording?: Readonly<{ prepareInputReplacement?(): MicrophoneMeterInputReplacement }> }>;
}

export interface SoundscaperAudioHostSnapshot {
	readonly host: string;
	readonly hosts: readonly Readonly<{ id: string; label: string }>[];
	readonly pending: boolean;
	readonly error: string;
	readonly failureCode?: AudioHostFailureCode | null;
}

export interface SoundscaperAudioHostRuntime {
	getSnapshot(): SoundscaperAudioHostSnapshot;
	subscribe(listener: () => void): () => void;
	refresh(): Promise<void>;
	setHost(host: string): Promise<void>;
	reportDeviceLoss(sessionId: string, reason: string): void;
	settle(): Promise<void>;
	dispose(): Promise<void>;
}

const HOST_LABELS: Readonly<Record<string, string>> = Object.freeze({
	electron: 'Electron', wasapi: 'WASAPI', asio: 'ASIO', coreaudio: 'Core Audio', pipewire: 'PipeWire', alsa: 'ALSA',
});
const ELECTRON_HOST = Object.freeze({ id: 'electron', label: 'Electron' });
const RUNTIMES = new WeakMap<object, SoundscaperAudioHostRuntime>();

/** Shared by Preferences and Audio setup, with its lifetime owned by the workspace. */
export function soundscaperAudioHostRuntimeFor(controller: object | null | undefined): SoundscaperAudioHostRuntime | null {
	return controller ? RUNTIMES.get(controller) ?? null : null;
}

export function isSoundscaperAudioHostController(value: unknown): value is SoundscaperAudioHostController {
	const port = value as Partial<SoundscaperAudioHostController> | null;
	return typeof port?.getSnapshot === 'function' && typeof port.subscribe === 'function'
		&& typeof port.actions?.audioDevices?.setHostInventory === 'function'
		&& typeof port.actions.audioDevices.requestAccess === 'function';
}

/** Routes one selected host into the existing device model and recording graph. */
export function createSoundscaperAudioHostRuntime(options: Readonly<{
	controller: SoundscaperAudioHostController;
	bridge: SoundscaperNativeServicesBridge;
	engine: Readonly<{ getAudioContext(options?: Readonly<{ resume?: boolean; sampleRate?: number }>): Promise<AudioContext> }>;
}>): SoundscaperAudioHostRuntime {
	const { controller, bridge } = options;
	const listeners = new Set<() => void>();
	const sessions = new Set<string>();
	let snapshot: SoundscaperAudioHostSnapshot = Object.freeze({
		host: preferences().host || 'electron', hosts: Object.freeze([ELECTRON_HOST]), pending: false, error: '', failureCode: null,
	});
	let availability: NativeAudioAvailability | null = null;
	let inventory: NativeAudioInventoryReport | null = null;
	let queue: Promise<void> = Promise.resolve();
	let connectedKey = '';
	let requestedKey = '';
	let suppressChanges = false;
	let disposed = false;
	let disposal: Promise<void> | null = null;
	let requestGeneration = 0;
	let inputReplacement: MicrophoneMeterInputReplacement | null = null;
	let inputAttachment: MicrophoneMeterInputReplacement | null = null;
	const unsubscribe = controller.subscribe(() => {
		if (disposed || suppressChanges || busy()) return;
		const key = preferenceKey();
		if (key === requestedKey || key === connectedKey && !snapshot.pending) return;
		requestedKey = key;
		void enqueue(async () => {
			await activate(preferences().host || 'electron', false);
		});
	});
	const runtime: SoundscaperAudioHostRuntime = Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		refresh: () => enqueue(async () => {
			await readAvailability();
			await activate(preferences().host || 'electron', true);
		}),
		setHost: (host: string) => enqueue(async () => {
			if (!availability) await readAvailability();
			if (!snapshot.hosts.some((candidate) => candidate.id === host)) {
				throw new AudioHostError('unavailable', 'This audio host is unavailable. Refresh audio devices and choose an available host.');
			}
			if (busy()) throw new AudioHostError('recording-active', 'Stop recording before changing the audio host.');
			await activate(host, true);
		}),
		reportDeviceLoss: (sessionId: string, reason: string) => {
			if (!sessions.has(sessionId) || disposed) return;
			connectedKey = '';
			requestedKey = preferenceKey();
			publish({ error: `The selected audio device disconnected (${reason}). Refresh audio devices or choose another host.`, failureCode: 'device-loss' });
		},
		settle: () => queue,
		dispose: () => {
			if (disposal) return disposal;
			disposed = true;
			unsubscribe();
			if (RUNTIMES.get(controller) === runtime) RUNTIMES.delete(controller);
			const retired = settleInputReplacement('disposed');
			const pending = Promise.all([queue, retired]).then(closeSessions).finally(() => { listeners.clear(); });
			disposal = pending;
			void pending.catch(() => { if (disposal === pending) disposal = null; });
			return pending;
		},
	});
	RUNTIMES.set(controller, runtime);
	return runtime;

	function preferences(): AudioHostPreferences { return controller.getSnapshot().audioDevices; }
	function preferenceKey(): string {
		const value = preferences();
		return [value.host, value.preferredInputDeviceId, value.preferredOutputDeviceId,
			value.preferredInputChannelCount, value.recordingSampleRate,
			isNativeAudioStreamingBackend(value.host) ? inputChannelCount(value) : 0].join('|');
	}
	function inputChannelCount(value: AudioHostPreferences, report = inventory): number {
		const input = report?.backend === value.host ? selectedDevice(report, 'input', value.preferredInputDeviceId) : null;
		const deviceId = input ? nativeAudioDeviceId(value.host, 'audio-input', input.handle) : value.preferredInputDeviceId;
		return Math.min(nativeAudioInputChannelDemand(value.preferredInputChannelCount, deviceId,
			controller.getSnapshot().recordingInputs?.routes), input?.channelCount || 2);
	}
	function busy(): boolean {
		const value = controller.getSnapshot();
		return value.recording === true || value.recordingStarting === true || value.recordingFinishing === true
			|| value.recordingScheduling === true || Boolean(value.scheduledRecording);
	}
	function publish(patch: Partial<SoundscaperAudioHostSnapshot>): void {
		if (disposed) return;
		snapshot = Object.freeze({ ...snapshot, ...patch });
		for (const listener of listeners) listener();
	}
	function assertActive(): void { if (disposed) throw new AudioHostError('closed', 'The audio host workspace has closed.'); }
	function assertCanReplaceDevices(): void {
		assertActive();
		if (busy()) throw new AudioHostError('recording-active', 'Stop recording or cancel scheduled recording before changing audio devices.');
	}
	function enqueue(operation: () => Promise<void>): Promise<void> {
		if (disposed) return Promise.resolve();
		const request = ++requestGeneration;
		queue = queue.then(async () => {
			if (disposed) return;
			publish({ pending: true, error: '', failureCode: null });
			let completed = false;
			try { await operation(); completed = true; }
			catch (error) { publish({ error: error instanceof Error ? error.message : String(error), failureCode: error instanceof AudioHostError ? error.code : 'operation' }); }
			finally {
				try { await settleInputReplacement(disposed ? 'disposed' : request !== requestGeneration ? 'superseded' : completed ? 'ready' : 'failed'); }
				catch (error) { publish({ error: error instanceof Error ? error.message : String(error), failureCode: 'operation' }); }
				requestedKey = preferenceKey(); publish({ pending: false });
			}
		});
		return queue;
	}
	async function settleInputReplacement(outcome: Parameters<MicrophoneMeterInputReplacement['finish']>[0]): Promise<void> {
		const current = inputReplacement;
		if (outcome === 'disposed') {
			const attached = inputAttachment; inputReplacement = null; inputAttachment = null;
			await Promise.all([current?.finish(outcome), attached !== current ? attached?.finish(outcome) : undefined]);
			return;
		}
		if (!current) return;
		if (outcome !== 'superseded') {
			inputReplacement = null; inputAttachment = outcome === 'ready' ? current : null;
		}
		await current.finish(outcome);
	}
	async function readAvailability(): Promise<void> {
		availability = await audioHostOperation('availability', () => bridge.nativeAudioHelperAvailability());
		assertActive();
		const nativeHosts = availability.payload.status === 'available' && !availability.quarantined
			? availability.backends.filter(isNativeAudioStreamingBackend).map((id) => Object.freeze({ id, label: HOST_LABELS[id] ?? id }))
			: [];
		publish({ hosts: Object.freeze([ELECTRON_HOST, ...nativeHosts]) });
	}
	async function closeSessions(): Promise<void> {
		const results = await Promise.allSettled([...sessions].map(async (sessionId) => {
			if (!await audioHostOperation('session-close', () => bridge.closeNativeAudioSession({ sessionId }))) throw new AudioHostError('session-close', 'The previous audio device did not close. Try refreshing audio devices.');
			sessions.delete(sessionId);
		}));
		const failed = results.find((result) => result.status === 'rejected');
		if (failed?.status === 'rejected') throw failed.reason;
	}
	async function activate(host: string, enumerate: boolean): Promise<void> {
		assertCanReplaceDevices();
		if (host === 'electron' && connectedKey === preferenceKey() && !enumerate) return;
		const previousHost = snapshot.host;
		let nextInventory: NativeAudioInventoryReport | null = null;
		if (host !== 'electron') {
			if (!isNativeAudioStreamingBackend(host)) throw new AudioHostError('unavailable', 'Choose an available audio host in audio settings.');
			if (!availability) await readAvailability();
			if (!snapshot.hosts.some((candidate) => candidate.id === host)) {
				throw new AudioHostError('unavailable', availability?.payload.detail || 'This native audio host is unavailable. Choose Electron or refresh audio devices.');
			}
			if (!await audioHostOperation('startup', () => bridge.setNativeAudioHelperEnabled(true))) throw new AudioHostError('startup', 'The native audio host could not start. Choose Electron or clear the audio helper quarantine in Audio settings.');
			assertActive();
			if (!enumerate && inventory?.backend === host) nextInventory = inventory;
			else {
				const outcome = await audioHostOperation('inventory', () => bridge.describeNativeAudioBackend({ backend: host }));
				assertActive();
				if (outcome.status !== 'described') throw new AudioHostError('inventory', outcome.message);
				nextInventory = outcome.inventory as NativeAudioInventoryReport;
			}
			if (!nextInventory.devices.length) {
				throw new AudioHostError('inventory', nextInventory.detail || 'No audio devices are available for the selected host.');
			}
		}
		assertCanReplaceDevices();
		inputReplacement = controller.actions.recording?.prepareInputReplacement?.() ?? inputReplacement;
		if (nextInventory) {
			const context = await audioHostOperation('rate-mismatch', () => options.engine.getAudioContext({ resume: true, sampleRate: preferences().recordingSampleRate }));
			assertCanReplaceDevices();
			if (context.sampleRate !== preferences().recordingSampleRate) throw new AudioHostError('rate-mismatch', 'The audio host could not use the selected recording sample rate. Choose another sample rate.');
		}
		await closeSessions();
		assertActive();
		if (!nextInventory) {
			await audioHostOperation('startup', () => bridge.setNativeAudioHelperEnabled(false));
			assertActive();
			await setInventory(host, null);
			if (previousHost !== 'electron' || !preferences().inputAccess) await audioHostOperation('startup', () => controller.actions.audioDevices.requestAccess());
			assertActive();
			connectedKey = preferenceKey();
			return;
		}
		try {
			const alternatives = automaticAsioDefaults(host, nextInventory, preferences());
			if (alternatives.length) {
				await connectAutomaticAsio(nextInventory, alternatives);
				return;
			}
			await setInventory(host, nextInventory);
			const settings = preferences(), routeKey = preferenceKey();
			const refused = await openRequests(routeRequests(host, nextInventory, settings, inputChannelCount(settings)), true);
			if (refused) throw new AudioHostError('session-open', refused.message);
			connectedKey = routeKey;
		} catch (error) { await closeSessions(); throw error; }
	}
	async function openRequests(requests: readonly NativeAudioSessionOpenRequestV1[], bindImmediately: boolean) {
		for (const request of requests) {
			const opened = await audioHostOperation('session-open', () => bridge.openNativeAudioSession(request));
			if (opened.status !== 'opened') return opened;
			sessions.add(opened.sessionId);
			assertActive();
			if (bindImmediately) await bindSession(opened.sessionId);
		}
		return null;
	}
	async function bindSession(sessionId: string): Promise<void> {
		await audioHostOperation('session-open', () => bridge.bindNativeAudioSession({ sessionId, queueCapacity: 8 }));
		assertActive();
	}
	async function connectAutomaticAsio(report: NativeAudioInventoryReport, alternatives: readonly NativeAudioDeviceDefaults[]): Promise<void> {
		const settings = preferences(), originalKey = preferenceKey();
		const assertCurrent = () => {
			assertCanReplaceDevices();
			if (preferenceKey() !== originalKey) throw new AudioHostError('session-open', 'The audio device choice changed while opening ASIO.');
		};
		let failure = '';
		for (const defaults of alternatives) {
			assertCurrent();
			const candidate = { ...settings, ...defaults, host: 'asio' };
			const refused = await openRequests(routeRequests('asio', report, candidate, inputChannelCount(candidate, report)), false);
			assertCurrent();
			if (!refused) {
				await setInventory('asio', report, defaults);
				const chosen = preferences();
				if (chosen.preferredInputDeviceId !== defaults.preferredInputDeviceId || chosen.preferredOutputDeviceId !== defaults.preferredOutputDeviceId) {
					throw new AudioHostError('session-open', 'The audio device choice changed while opening ASIO.');
				}
				const routeKey = preferenceKey();
				for (const sessionId of sessions) await bindSession(sessionId);
				connectedKey = routeKey;
				return;
			}
			await closeSessions();
			failure ||= refused.message;
			if (refused.code !== 'device-unavailable' && refused.code !== 'format-refused') {
				failure = refused.message;
				break;
			}
		}
		assertCurrent();
		await setInventory('asio', report, { preferredInputDeviceId: '', preferredOutputDeviceId: '' });
		throw new AudioHostError('session-open', failure);
	}
	async function setInventory(host: string, value: NativeAudioInventoryReport | null, defaults?: NativeAudioDeviceDefaults): Promise<void> {
		suppressChanges = true;
		try { await controller.actions.audioDevices.setHostInventory(host, value, defaults); }
		finally { suppressChanges = false; }
		assertActive();
		inventory = value;
		publish({ host });
	}
}

/** ASIO's inventory includes registered drivers even when their hardware is disconnected. */
function automaticAsioDefaults(host: string, inventory: NativeAudioInventoryReport, settings: AudioHostPreferences): readonly NativeAudioDeviceDefaults[] {
	if (host !== 'asio' || settings.preferredInputDeviceId.startsWith('native:asio:in:')
		|| settings.preferredOutputDeviceId.startsWith('native:asio:out:')) return [];
	const input = selectedDevice(inventory, 'input', settings.preferredInputDeviceId);
	const output = selectedDevice(inventory, 'output', settings.preferredOutputDeviceId);
	if (!input || input.handle !== output?.handle) return [];
	const outputHandles = new Set(inventory.devices.filter(device => device.direction !== 'input').map(device => device.handle));
	const handles = new Set([input.handle, ...inventory.devices.filter(device => device.direction !== 'output' && outputHandles.has(device.handle))
		.map(device => device.handle)]);
	return [...handles].slice(0, 4).map(handle => ({
		preferredInputDeviceId: nativeAudioDeviceId(host, 'audio-input', handle),
		preferredOutputDeviceId: nativeAudioDeviceId(host, 'audio-output', handle),
	}));
}

function routeRequests(host: string, inventory: NativeAudioInventoryReport, settings: AudioHostPreferences, inputChannels: number): readonly NativeAudioSessionOpenRequestV1[] {
	if (!isNativeAudioStreamingBackend(host)) return [];
	const input = selectedDevice(inventory, 'input', settings.preferredInputDeviceId);
	const output = selectedDevice(inventory, 'output', settings.preferredOutputDeviceId);
	const request = (device: NativeAudioDeviceReport, direction: 'input' | 'output' | 'duplex', channelCount: number) => createNativeAudioRouteOpenRequest({
		candidates: [{ backend: host, deviceHandle: device.handle }], direction,
		mode: host === 'asio' ? 'exclusive' : 'shared', sampleRate: settings.recordingSampleRate,
		periodFrames: 256, channelCount,
	});
	const outputChannels = Math.min(2, output?.channelCount || 2);
	if (input && output && input.handle === output.handle && inputChannels === outputChannels) return [request(input, 'duplex', inputChannels)];
	return [input ? request(input, 'input', inputChannels) : null, output ? request(output, 'output', outputChannels) : null]
		.filter((value): value is NativeAudioSessionOpenRequestV1 => value !== null);
}

function selectedDevice(inventory: NativeAudioInventoryReport, direction: 'input' | 'output', deviceId: string): NativeAudioDeviceReport | undefined {
	const kind = direction === 'input' ? 'audio-input' : 'audio-output';
	const devices = inventory.devices.filter((device) => device.direction === direction || device.direction === 'duplex');
	return devices.find((device) => nativeAudioDeviceId(inventory.backend, kind, device.handle) === deviceId)
		?? devices.find((device) => device.isDefault) ?? devices[0];
}
