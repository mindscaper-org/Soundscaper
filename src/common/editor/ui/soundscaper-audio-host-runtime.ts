/* SPDX-License-Identifier: AGPL-3.0-only */

import { AudioHostError, audioHostOperation, type AudioHostFailureCode } from './audio-host-failure.ts';
import { nativeAudioDeviceId, type NativeAudioDeviceDefaults, type NativeAudioInventoryReport } from '../controller/recording/native-audio-inventory.ts';
import { isNativeAudioStreamingBackend, nativeAudioInputChannelDemand, routeRequests, selectedDevice } from './soundscaper-native-audio-route.ts';
import type { NativeAudioAvailability, NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from './soundscaper-native-services-bridge.ts';
import type { MicrophoneMeterInputReplacement } from '../controller/recording/microphone-meter-service.ts';
import { normalizeRecordingSampleRate } from '../controller/recording/recording-model.ts';
import { guardSoundscaperNativeAudioOutput, selectSoundscaperBrowserAudioOutput } from '../soundscaper-native-audio-renderer.ts';
import { guardSoundscaperDefaultRecordingInput, registerSoundscaperNativeRecordingInput, type NativeRecordingInputRequest } from '../soundscaper-native-audio-capture.ts';

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
		setRecordingSampleRate(sampleRate: number): Promise<unknown>;
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
	setRecordingSampleRate(sampleRate: number): Promise<void>;
	reportDeviceLoss(sessionId: string, reason: string): void;
	settle(): Promise<void>;
	dispose(): Promise<void>;
}

const HOST_LABELS: Readonly<Record<string, string>> = Object.freeze({
	electron: 'Electron', wasapi: 'WASAPI', asio: 'ASIO', coreaudio: 'Core Audio', pipewire: 'PipeWire', alsa: 'ALSA',
});
const ELECTRON_HOST = Object.freeze({ id: 'electron', label: 'Electron' });
const RUNTIMES = new WeakMap<object, SoundscaperAudioHostRuntime>();

interface OpenAudioRoute {
	readonly request: NativeAudioSessionOpenRequestV1;
	state: 'open' | 'bound' | 'lost';
}

/** Shared by Preferences and Audio setup, with its lifetime owned by the workspace. */
export function soundscaperAudioHostRuntimeFor(controller: object | null | undefined): SoundscaperAudioHostRuntime | null {
	return controller ? RUNTIMES.get(controller) ?? null : null;
}

export function isSoundscaperAudioHostController(value: unknown): value is SoundscaperAudioHostController {
	const port = value as Partial<SoundscaperAudioHostController> | null;
	return typeof port?.getSnapshot === 'function' && typeof port.subscribe === 'function'
		&& typeof port.actions?.audioDevices?.setHostInventory === 'function'
		&& typeof port.actions.audioDevices.setRecordingSampleRate === 'function'
		&& typeof port.actions.audioDevices.requestAccess === 'function';
}

/** Routes one selected host into the existing device model and recording graph. */
export function createSoundscaperAudioHostRuntime(options: Readonly<{
	controller: SoundscaperAudioHostController;
	bridge: SoundscaperNativeServicesBridge;
	engine: Readonly<{ getAudioContext(options?: Readonly<{ resume?: boolean; sampleRate?: number | null }>): Promise<AudioContext> }>;
}>): SoundscaperAudioHostRuntime {
	const { controller, bridge } = options;
	const listeners = new Set<() => void>();
	const sessions = new Map<string, OpenAudioRoute>();
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
	let releaseRecordingInputOverride: (() => void) | null = null;
	let restoringRecordingInput = false;
	const unregisterRecordingInput = registerSoundscaperNativeRecordingInput(request => enqueue(() => preparePinnedRecordingInput(request), true));
	const unsubscribe = controller.subscribe(() => {
		if (disposed || suppressChanges || busy()) return;
		const key = preferenceKey();
		const restore = releaseRecordingInputOverride !== null && !restoringRecordingInput;
		if (!restore && (key === requestedKey || key === connectedKey && !snapshot.pending)) return;
		if (restore) restoringRecordingInput = true;
		requestedKey = key;
		void enqueue(async () => {
			try {
				await activate(preferences().host || 'electron', false);
			} finally { if (restore) restoringRecordingInput = false; }
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
		setRecordingSampleRate: (sampleRate: number) => enqueue(() => changeRecordingSampleRate(sampleRate)),
		reportDeviceLoss: (sessionId: string, reason: string) => {
			const session = sessions.get(sessionId);
			if (!session || disposed) return;
			session.state = 'lost';
			connectedKey = '';
			requestedKey = preferenceKey();
			publish({ error: `The selected audio device disconnected (${reason}). Refresh audio devices or choose another host.`, failureCode: 'device-loss' });
		},
		settle: () => queue,
		dispose: () => {
			if (disposal) return disposal;
			disposed = true;
			unsubscribe();
			unregisterRecordingInput();
			if (RUNTIMES.get(controller) === runtime) RUNTIMES.delete(controller);
			const retired = settleInputReplacement('disposed');
			const pending = Promise.all([queue, retired]).then(() => closeSessions()).then(clearRecordingInputOverride)
				.finally(() => { listeners.clear(); });
			disposal = pending;
			void pending.catch(() => { if (disposal === pending) disposal = null; });
			return pending;
		},
	});
	RUNTIMES.set(controller, runtime);
	return runtime;

	function preferences(): AudioHostPreferences { return controller.getSnapshot().audioDevices; }
	function preferenceKey(value = preferences()): string {
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
	function clearRecordingInputOverride(): void {
		releaseRecordingInputOverride?.();
		releaseRecordingInputOverride = null;
	}
	function assertCanReplaceDevices(): void {
		assertActive();
		if (busy()) throw new AudioHostError('recording-active', 'Stop recording or cancel scheduled recording before changing audio devices.');
	}
	function publishFailure(error: unknown): void {
		publish({ error: errorMessage(error), failureCode: error instanceof AudioHostError ? error.code : 'operation' });
	}
	function enqueue(operation: () => Promise<void>, propagateFailure = false): Promise<void> {
		const request = ++requestGeneration;
		const run = queue.then(async () => {
			if (disposed) { if (propagateFailure) assertActive(); return; }
			publish({ pending: true, error: '', failureCode: null });
			let completed = false;
			try { await operation(); completed = true; }
			catch (error) { publishFailure(error); if (propagateFailure) throw error; }
			finally {
				try { await settleInputReplacement(disposed ? 'disposed' : request !== requestGeneration ? 'superseded' : completed ? 'ready' : 'failed'); }
				catch (error) { publish({ error: error instanceof Error ? error.message : String(error), failureCode: 'operation' }); }
				requestedKey = preferenceKey(); publish({ pending: false });
			}
		});
		queue = propagateFailure ? run.catch(() => undefined) : run;
		return run;
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
	async function closeSessions(retained?: ReadonlySet<string>, replacementContext?: AudioContext): Promise<void> {
		const closing = [...sessions].filter(([id]) => !retained?.has(id));
		if (replacementContext && closing.some(([, session]) => session.request.direction !== 'input')) {
			guardSoundscaperNativeAudioOutput(replacementContext);
		}
		const results = await Promise.allSettled(closing.map(async ([sessionId]) => {
			if (!await audioHostOperation('session-close', () => bridge.closeNativeAudioSession({ sessionId }))) throw new AudioHostError('session-close', 'The previous audio device did not close. Try refreshing audio devices.');
			sessions.delete(sessionId);
		}));
		const failed = results.find((result) => result.status === 'rejected');
		if (failed?.status === 'rejected') throw failed.reason;
	}
	async function preparePinnedRecordingInput(request: NativeRecordingInputRequest): Promise<void> {
		const settings = preferences(), report = inventory;
		const before = preferenceKey();
		const assertCurrent = () => {
			request.signal?.throwIfAborted();
			assertActive();
			const current = controller.getSnapshot();
			if (!current.recordingStarting || current.recording || current.recordingFinishing || before !== preferenceKey()) {
				throw new AudioHostError('recording-active', 'The recording input changed while it was being prepared.');
			}
		};
		assertCurrent();
		if (settings.host !== 'wasapi' || report?.backend !== 'wasapi') throw new AudioHostError('unavailable', 'The selected WASAPI microphone is unavailable.');
		if (settings.recordingSampleRate !== request.sampleRate) throw new AudioHostError('rate-mismatch', 'The recording sample rate changed before input preparation.');
		const device = selectedDevice(report, 'input', request.deviceId);
		if (!device || nativeAudioDeviceId('wasapi', 'audio-input', device.handle) !== request.deviceId) throw new AudioHostError('inventory', 'The assigned WASAPI microphone is unavailable.');
		const previous = [...sessions.values()].find(session => session.request.direction !== 'output' && session.state === 'bound');
		if (previous?.request.candidates[0]?.deviceHandle === device.handle
			&& previous.request.sampleRate === request.sampleRate && previous.request.channelCount >= request.channelCount) return;
		const pending = routeRequests('wasapi', report, { ...settings, preferredInputDeviceId: request.deviceId }, request.channelCount)
			.find(candidate => candidate.direction === 'input');
		if (!pending || previous?.request.direction === 'duplex') throw new AudioHostError('session-open', 'The assigned WASAPI microphone cannot replace a duplex session.');
		const retained = new Set([...sessions].filter(([, session]) => session.request.direction === 'output').map(([id]) => id));
		const primary = selectedDevice(report, 'input', settings.preferredInputDeviceId) ?? device;
		releaseRecordingInputOverride ??= guardSoundscaperDefaultRecordingInput(nativeAudioDeviceId('wasapi', 'audio-input', primary.handle));
		connectedKey = '';
		inputReplacement = controller.actions.recording?.prepareInputReplacement?.() ?? inputReplacement;
		await closeSessions(retained);
		try {
			assertCurrent();
			await openBoundRequests([pending]);
			assertCurrent();
			if (![...sessions.values()].some(session => session.request === pending && session.state === 'bound')) {
				throw new AudioHostError('device-loss', 'The assigned WASAPI microphone disconnected before recording.');
			}
		} catch (error) {
			await closeSessions(retained);
			throw error;
		}
	}
	async function changeRecordingSampleRate(sampleRate: number): Promise<void> {
		assertCanReplaceDevices();
		const previous = preferences();
		if (sampleRate === previous.recordingSampleRate) return;
		if (sampleRate !== normalizeRecordingSampleRate(sampleRate)) throw new AudioHostError('rate-mismatch', 'Choose a valid recording sample rate.');
		if (inventory?.backend !== previous.host) throw new AudioHostError('inventory', 'Refresh audio devices before changing the recording sample rate.');
		const next = { ...previous, recordingSampleRate: sampleRate };
		const plan = routeRequests(previous.host, inventory, next, inputChannelCount(next));
		if (!plan.length) throw new AudioHostError('inventory', 'No audio devices are available for the selected host.');
		const before = preferenceKey(), after = preferenceKey(next), previousConnection = connectedKey;
		const previousRoutes = [...sessions.values()].filter(session => session.state === 'bound').map(session => session.request);
		const replacesOutput = plan.some(request => request.direction !== 'input');
		const assertCurrent = () => {
			assertCanReplaceDevices();
			if (before !== preferenceKey()) throw new AudioHostError('session-open', 'The audio device choice changed while opening the selected rate.');
		};
		const previousContext = await options.engine.getAudioContext({ resume: false }).catch(() => null);
		assertCurrent();
		inputReplacement = controller.actions.recording?.prepareInputReplacement?.() ?? inputReplacement;
		let trialContext: AudioContext | undefined;
		try {
			trialContext = await prepareRate(sampleRate);
			if (replacesOutput) guardSoundscaperNativeAudioOutput(trialContext);
			connectedKey = '';
			await closeSessions(undefined, trialContext);
			assertCurrent();
			const refused = await openRequests(plan, true);
			if (refused) throw new AudioHostError(refused.code === 'format-refused' ? 'rate-mismatch' : 'session-open', refused.message);
			assertCurrent();
			if ([...sessions.values()].some(session => session.state !== 'bound')) {
				throw new AudioHostError('device-loss', 'The selected audio device disconnected while opening the selected rate.');
			}
			requestedKey = after;
			await controller.actions.audioDevices.setRecordingSampleRate(sampleRate);
			connectedKey = after;
		} catch (error) {
			assertActive();
			if (before !== preferenceKey()) {
				connectedKey = '';
				await closeSessions(undefined, trialContext);
				throw error;
			}
			let recovery: string[];
			try {
				if (trialContext) await closeSessions(undefined, trialContext);
				const context = await prepareRate(previous.recordingSampleRate);
				if (replacesOutput) guardSoundscaperNativeAudioOutput(context);
				if (!trialContext && context !== previousContext) await closeSessions(undefined, context);
				recovery = trialContext || context !== previousContext ? await restoreRateRoutes(previousRoutes) : [];
			} catch (failure) { recovery = [errorMessage(failure)]; }
			connectedKey = recovery.length ? '' : previousConnection;
			const failure = recovery.length
				? new AudioHostError('session-open', `${errorMessage(error)} The previous audio route could not be restored. ${recovery.join(' ')}`)
				: error;
			// Only a recovered input can support idle microphone metering.
			if (![...sessions.values()].some(({ state, request }) => state === 'bound' && request.direction !== 'output')) throw failure;
			publishFailure(failure);
		}
	}
	async function prepareRate(sampleRate: number): Promise<AudioContext> {
		const context = await audioHostOperation('rate-mismatch', () => options.engine.getAudioContext({ resume: true, sampleRate }));
		if (context.sampleRate !== sampleRate) throw new AudioHostError('rate-mismatch', 'The audio host could not use the selected recording sample rate. Choose another sample rate.');
		return context;
	}
	async function restoreRateRoutes(requests: readonly NativeAudioSessionOpenRequestV1[]): Promise<string[]> {
		const failures: string[] = [];
		for (const request of requests) {
			const retained = new Set(sessions.keys());
			try { await openBoundRequests([request]); }
			catch (error) { await closeSessions(retained); failures.push(errorMessage(error)); }
		}
		return failures;
	}
	async function activate(host: string, enumerate: boolean): Promise<void> {
		assertCanReplaceDevices();
		if (host === 'electron' && connectedKey === preferenceKey() && !enumerate) return;
		const previousHost = snapshot.host;
		let nextInventory: NativeAudioInventoryReport | null = null;
		let replacementContext: AudioContext | undefined;
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
		const settings = preferences();
		let routeKey = preferenceKey();
		const proposed = nextInventory && !automaticAsioDefaults(host, nextInventory, settings).length
			? routeRequests(host, nextInventory, settings, inputChannelCount(settings, nextInventory)) : null;
		let requests = nextInventory === inventory && !enumerate ? proposed : null;
		const retained = new Map([...sessions].filter(([, session]) => session.state === 'bound'
			&& proposed?.some(request => sameRoute(session.request, request))));
		// Refresh reopens a complete set of routes. When repairing one route, keep its matching sibling.
		if (!requests && proposed?.length === retained.size) retained.clear();
		const keepsInput = () => [...retained.values()].some(({ request }) => request.direction !== 'output');
		const inputWasRetained = keepsInput();
		if (!inputWasRetained) {
			inputReplacement = controller.actions.recording?.prepareInputReplacement?.() ?? inputReplacement;
		}
		if (nextInventory) {
			const sampleRate = settings.recordingSampleRate;
			const context = await audioHostOperation('rate-mismatch', () => options.engine.getAudioContext({ resume: true, sampleRate }));
			assertCanReplaceDevices();
			if ((requests || retained.size) && routeKey !== preferenceKey()) return;
			if (context.sampleRate !== sampleRate) throw new AudioHostError('rate-mismatch', 'The audio host could not use the selected recording sample rate. Choose another sample rate.');
			replacementContext = context;
			if (!requests && retained.size) {
				await setInventory(host, nextInventory);
				assertCanReplaceDevices();
				const current = preferences();
				routeKey = preferenceKey();
				requests = routeRequests(host, nextInventory, current, inputChannelCount(current));
				for (const [id, session] of retained) {
					if (!requests.some(request => sameRoute(session.request, request))) retained.delete(id);
				}
			}
		}
		for (const [id, session] of retained) if (session.state !== 'bound') retained.delete(id);
		if (inputWasRetained && !keepsInput()) inputReplacement = controller.actions.recording?.prepareInputReplacement?.() ?? inputReplacement;
		const retainedIds = new Set(retained.keys());
		if (retainedIds.size < sessions.size) connectedKey = '';
		await closeSessions(retainedIds, replacementContext);
		assertActive();
		if (!nextInventory) {
			clearRecordingInputOverride();
			await audioHostOperation('startup', () => bridge.setNativeAudioHelperEnabled(false));
			assertActive();
			await setInventory(host, null);
			if (isNativeAudioStreamingBackend(previousHost)) {
				const context = await audioHostOperation('rate-mismatch', () => options.engine.getAudioContext({ resume: false, sampleRate: null }));
				selectSoundscaperBrowserAudioOutput(context);
			}
			if (previousHost !== 'electron' || !preferences().inputAccess) await audioHostOperation('startup', () => controller.actions.audioDevices.requestAccess());
			assertActive();
			connectedKey = preferenceKey();
			return;
		}
		try {
			let plan = requests, key = routeKey;
			if (!plan) {
				const alternatives = automaticAsioDefaults(host, nextInventory, preferences());
				if (alternatives.length) {
					await connectAutomaticAsio(nextInventory, alternatives);
					clearRecordingInputOverride();
					return;
				}
				await setInventory(host, nextInventory);
				const current = preferences();
				key = preferenceKey();
				plan = routeRequests(host, nextInventory, current, inputChannelCount(current));
			}
			const pending = plan.filter(request => ![...retained.values()].some(session => sameRoute(session.request, request)));
			await openBoundRequests(pending);
			const defaultInput = plan.find(request => request.direction !== 'output');
			if (releaseRecordingInputOverride && (!defaultInput || ![...sessions.values()]
				.some(session => session.state === 'bound' && sameRoute(session.request, defaultInput)))) {
				throw new AudioHostError('device-loss', 'The default microphone disconnected before it was restored.');
			}
			connectedKey = key;
			clearRecordingInputOverride();
		} catch (error) { await closeSessions(retainedIds, replacementContext); throw error; }
	}
	async function openBoundRequests(requests: readonly NativeAudioSessionOpenRequestV1[]): Promise<void> {
		const refused = await openRequests(requests, true);
		if (refused) throw new AudioHostError('session-open', refused.message);
	}
	async function openRequests(requests: readonly NativeAudioSessionOpenRequestV1[], bindImmediately: boolean) {
		for (const request of requests) {
			const opened = await audioHostOperation('session-open', () => bridge.openNativeAudioSession(request));
			if (opened.status !== 'opened') return opened;
			sessions.set(opened.sessionId, { request, state: 'open' });
			assertActive();
			if (bindImmediately) await bindSession(opened.sessionId);
		}
		return null;
	}
	async function bindSession(sessionId: string): Promise<void> {
		await audioHostOperation('session-open', () => bridge.bindNativeAudioSession({ sessionId, queueCapacity: 8 }));
		assertActive();
		const session = sessions.get(sessionId);
		if (session?.state === 'open') session.state = 'bound';
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
				for (const sessionId of sessions.keys()) await bindSession(sessionId);
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

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function sameRoute(left: NativeAudioSessionOpenRequestV1, right: NativeAudioSessionOpenRequestV1): boolean {
	return left.direction === right.direction && left.mode === right.mode && left.sampleRate === right.sampleRate
		&& left.periodFrames === right.periodFrames && left.channelCount === right.channelCount
		&& left.candidates[0]?.backend === right.candidates[0]?.backend && left.candidates[0]?.deviceHandle === right.candidates[0]?.deviceHandle;
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
