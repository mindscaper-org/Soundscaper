/* SPDX-License-Identifier: AGPL-3.0-only */

import { AudioHostError, audioHostOperation, type AudioHostFailureCode } from './audio-host-failure.ts';
import { nativeAudioDeviceId, type NativeAudioDeviceReport, type NativeAudioInventoryReport } from '../controller/recording/native-audio-inventory.ts';
import { createNativeAudioRouteOpenRequest, isNativeAudioStreamingBackend } from './soundscaper-native-audio-route.ts';
import type { NativeAudioAvailability, NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from './soundscaper-native-services-bridge.ts';

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
		recordingStarting?: boolean; recordingFinishing?: boolean; recordingScheduling?: boolean; scheduledRecording?: unknown }>;
	subscribe(listener: () => void): () => void;
	readonly actions: Readonly<{ audioDevices: Readonly<{
		setHostInventory(host: string, inventory: NativeAudioInventoryReport | null): Promise<unknown>;
		requestAccess(): Promise<unknown>;
	}> }>;
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
	const unsubscribe = controller.subscribe(() => {
		if (disposed || suppressChanges || busy()) return;
		const key = preferenceKey();
		if (key === connectedKey || key === requestedKey) return;
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
			const pending = queue.then(closeSessions).finally(() => { listeners.clear(); });
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
			value.preferredInputChannelCount, value.recordingSampleRate].join('|');
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
	function enqueue(operation: () => Promise<void>): Promise<void> {
		if (disposed) return Promise.resolve();
		queue = queue.then(async () => {
			if (disposed) return;
			publish({ pending: true, error: '', failureCode: null });
			try { await operation(); }
			catch (error) { publish({ error: error instanceof Error ? error.message : String(error), failureCode: error instanceof AudioHostError ? error.code : 'operation' }); }
			finally { requestedKey = preferenceKey(); publish({ pending: false }); }
		});
		return queue;
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
		assertActive();
		if (busy()) throw new AudioHostError('recording-active', 'Stop recording or cancel scheduled recording before changing audio devices.');
		if (host === 'electron' && connectedKey === preferenceKey() && !enumerate) return;
		const previousHost = snapshot.host;
		if (host !== 'electron') {
			if (!isNativeAudioStreamingBackend(host)) throw new AudioHostError('unavailable', 'Choose an available audio host in audio settings.');
			if (!availability) await readAvailability();
			if (!snapshot.hosts.some((candidate) => candidate.id === host)) {
				throw new AudioHostError('unavailable', availability?.payload.detail || 'This native audio host is unavailable. Choose Electron or refresh audio devices.');
			}
			const context = await audioHostOperation('rate-mismatch', () => options.engine.getAudioContext({ resume: true, sampleRate: preferences().recordingSampleRate }));
			assertActive();
			if (context.sampleRate !== preferences().recordingSampleRate) throw new AudioHostError('rate-mismatch', 'The audio host could not use the selected recording sample rate. Choose another sample rate.');
		}
		await closeSessions();
		assertActive();
		if (host === 'electron') {
			await audioHostOperation('startup', () => bridge.setNativeAudioHelperEnabled(false));
			assertActive();
			await setInventory(host, null);
			if (previousHost !== 'electron' || !preferences().inputAccess) await audioHostOperation('startup', () => controller.actions.audioDevices.requestAccess());
			assertActive();
			connectedKey = preferenceKey();
			return;
		}
		if (!await audioHostOperation('startup', () => bridge.setNativeAudioHelperEnabled(true))) throw new AudioHostError('startup', 'The native audio host could not start. Choose Electron or clear the audio helper quarantine in Audio settings.');
		assertActive();
		if (enumerate || inventory?.backend !== host) {
			const outcome = await audioHostOperation('inventory', () => bridge.describeNativeAudioBackend({ backend: host }));
			assertActive();
			if (outcome.status !== 'described') throw new AudioHostError('inventory', outcome.message);
			inventory = outcome.inventory as NativeAudioInventoryReport;
		}
		if (!inventory) throw new AudioHostError('inventory', 'The selected host did not provide an audio device inventory.');
		await setInventory(host, inventory);
		const settings = preferences();
		try {
			for (const request of routeRequests(host, inventory, settings)) {
				const opened = await audioHostOperation('session-open', () => bridge.openNativeAudioSession(request));
				if (opened.status !== 'opened') throw new AudioHostError('session-open', opened.message);
				sessions.add(opened.sessionId);
				assertActive();
				await audioHostOperation('session-open', () => bridge.bindNativeAudioSession({ sessionId: opened.sessionId, queueCapacity: 8 }));
				assertActive();
			}
			connectedKey = preferenceKey();
		} catch (error) { await closeSessions(); throw error; }
	}
	async function setInventory(host: string, value: NativeAudioInventoryReport | null): Promise<void> {
		suppressChanges = true;
		try { await controller.actions.audioDevices.setHostInventory(host, value); }
		finally { suppressChanges = false; }
		assertActive();
		inventory = value;
		publish({ host });
	}
}

function routeRequests(host: string, inventory: NativeAudioInventoryReport, settings: AudioHostPreferences): readonly NativeAudioSessionOpenRequestV1[] {
	if (!isNativeAudioStreamingBackend(host)) return [];
	const input = selectedDevice(inventory, 'input', settings.preferredInputDeviceId);
	const output = selectedDevice(inventory, 'output', settings.preferredOutputDeviceId);
	const request = (device: NativeAudioDeviceReport, direction: 'input' | 'output' | 'duplex', channelCount: number) => createNativeAudioRouteOpenRequest({
		candidates: [{ backend: host, deviceHandle: device.handle }], direction,
		mode: host === 'asio' ? 'exclusive' : 'shared', sampleRate: settings.recordingSampleRate,
		periodFrames: 256, channelCount,
	});
	const inputChannels = Math.min(settings.preferredInputChannelCount || 1, input?.channelCount || 2);
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
