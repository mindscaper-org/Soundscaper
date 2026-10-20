/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingRoutingDeviceRow,
	RecordingRoutingNativeInventory,
	RecordingRoutingProject,
	RecordingRoutingRefreshOptions,
	RecordingRoutingServiceRuntime,
} from './recording-routing-service-types.d.ts';
import { adaptNativeAudioInventory, type NativeAudioInventoryReport } from '../native-audio-inventory.ts';
import { normalizeRecordingSampleRate } from '../recording-model.ts';
import { preferredRecordingRoutes } from './preferred-recording-routes.ts';
import { supportsDisplayAudioCapture } from '../../../recording-display-input.ts';
import { raceAbortableRead } from '../../../abort-race.ts';

export type {
	PersistedRecordingRouting,
	RecordingPreferencePatch,
	RecordingRoutingCapturePool,
	RecordingRoutingDeviceRow,
	RecordingRoutingMediaDevice,
	RecordingRoutingMediaDevices,
	RecordingRoutingNativeInventory,
	RecordingRoutingProject,
	RecordingRoutingRefreshOptions,
	RecordingRoutingServiceRuntime,
	RecordingRoutingState,
	RecordingRoutingTrack,
} from './recording-routing-service-types.d.ts';

export function createRecordingRoutingService<
	Project extends RecordingRoutingProject = RecordingRoutingProject,
	Stream = unknown,
>(runtime: RecordingRoutingServiceRuntime<Project, Stream>) {
	const {
		AUDIO_DEVICE_PREFERENCES_SETTING_KEY, RECORDING_CHANNEL_COUNT_MAXIMUM, RECORDING_DEFAULT_DEVICE_ID, RECORDING_DISPLAY_SOURCE_KEY,
		engine, lifetime, mediaDevices, microphoneMeterDeviceId,
		getMicrophoneMeterSession, invalidateMicrophoneMeter, normalizePreferredInputDeviceId, normalizePreferredOutputDeviceId,
		normalizeRecordingRouting, persistSetting, productSettingKey, getProject,
		projectSampleRate, publishDocumentSnapshot, recordingCapturePool, recordingRouteSourceKey,
		recordingRoutingSettingKey, setRecordingSourceOffset, state,
		stopMicrophoneMetering, store, updatePreferences,
	} = runtime;
	let outputDeviceSelectionGeneration = 0;
	let inventoryGeneration = 0;
	let retainedNativeInventory: RecordingRoutingNativeInventory | null = null;
	async function loadRecordingRouting(currentProject: Project | null = getProject()) {
		if (!currentProject) {
			state.recordingRouting = normalizeRecordingRouting();
			state.recordingDevices = [];
			state.recordingRouteHealth = {};
			return state.recordingRouting;
		}
		let saved: unknown = null;
		try {
			saved = await store.loadSetting(recordingRoutingSettingKey(currentProject.id), null);
		} catch {
			// Local routing is optional and must never prevent a project from opening.
		}
		const storedRouting = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
		state.recordingRouting = normalizeRecordingRouting(storedRouting, currentProject.tracks);
		state.recordingRouteHealth = Object.fromEntries(Object.keys(state.recordingRouting.routes)
			.map((trackId) => [trackId, 'unavailable']));
		updateRecordingDeviceRows();
		syncRecordingPoolSnapshot();
		return state.recordingRouting;
	}

	function persistRecordingRouting() {
		const project = getProject();
		if (!project) return Promise.resolve(state.recordingRouting);
		return persistSetting(recordingRoutingSettingKey(project.id), state.recordingRouting, { policy: 'required' })
			.then(() => state.recordingRouting);
	}

	async function requestInputAccess() {
		if (!mediaDevices?.getUserMedia) throw new Error('Hardware audio recording is not supported in this browser.');
		const sampleRate = recordingInputSampleRate();
		const opened: string[] = [];
		const failures: unknown[] = [];
		try {
			await recordingCapturePool.acquireHardware(RECORDING_DEFAULT_DEVICE_ID, { channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM, sampleRate });
			opened.push(RECORDING_DEFAULT_DEVICE_ID);
		} catch (error) {
			failures.push(error);
		}
		await refreshRecordingInputs({ probe: false });
		const deviceIds = state.recordingDevices
			.map((device) => device.deviceId)
			.filter((deviceId) => deviceId && deviceId !== RECORDING_DEFAULT_DEVICE_ID);
		const results = await Promise.allSettled(deviceIds.map((deviceId) => (
			recordingCapturePool.acquireHardware(deviceId, { channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM, sampleRate })
		)));
		for (let index = 0; index < results.length; index += 1) {
			const result = results[index];
			if (result?.status === 'fulfilled') opened.push(deviceIds[index]);
			else if (result) failures.push(result.reason);
		}
		state.audioInputAccess = opened.length > 0;
		syncRecordingPoolSnapshot();
		await refreshRecordingInputs({ probe: false });
		if (!state.recorder) releaseUnretainedRecordingInputs();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		if (!opened.length && failures[0]) throw failures[0];
		return state.recordingDevices;
	}

	async function refreshRecordingInputs({ probe = true }: Pick<RecordingRoutingRefreshOptions, 'probe'> = {}) {
		return refreshAudioDevices({ probe });
	}

	async function refreshAudioDevices({
		probe = true,
		publish = true,
		nativeInventory,
	}: RecordingRoutingRefreshOptions = {}) {
		lifetime.signal.throwIfAborted();
		const generation = ++inventoryGeneration;
		if (nativeInventory !== undefined) retainedNativeInventory = nativeInventory;
		const webInputs: RecordingRoutingDeviceRow[] = [];
		const webOutputs: RecordingRoutingDeviceRow[] = [];
		const webHost = state.audioHost === 'browser' || state.audioHost === 'electron';
		const enumerateDevices = webHost ? mediaDevices?.enumerateDevices : null;
		if (enumerateDevices) {
			const devices = await raceAbortableRead(() => enumerateDevices.call(mediaDevices), lifetime.signal);
			for (const device of devices || []) {
				if (!device?.deviceId) continue;
				const row = {
					deviceId: String(device.deviceId),
					label: String(device.label || ''),
					groupId: String(device.groupId || ''),
				};
				if (device.kind === 'audioinput') webInputs.push(row);
				else if (device.kind === 'audiooutput' && row.deviceId !== 'default') webOutputs.push(row);
			}
		}
		lifetime.signal.throwIfAborted();
		if (!isCurrentInventory(generation) && !probe) return state.recordingDevices;
		const discoveredInputs = uniqueDeviceRows(webHost ? webInputs : [...(retainedNativeInventory?.inputs || [])]);
		const discoveredOutputs = uniqueDeviceRows(webHost ? webOutputs : [...(retainedNativeInventory?.outputs || [])]);
		if (isCurrentInventory(generation)) {
			state.recordingEnumeratedDeviceIds = new Set(discoveredInputs.map((device) => device.deviceId));
			if (discoveredInputs.some((device) => device.label)) state.audioInputAccess = true;
			updateRecordingDeviceRows(discoveredInputs);
			state.audioInputDevices = Object.freeze(state.recordingDevices.filter((device) => state.recordingEnumeratedDeviceIds.has(device.deviceId)).map((device, index) => Object.freeze({
				deviceId: device.deviceId,
				isDefault: device.isDefault === true, groupId: device.groupId ?? '',
				label: device.label || `Audio input ${index + 1}`,
				channelCount: device.channelCount,
				status: device.status,
			})));
			state.audioOutputDevices = Object.freeze(discoveredOutputs.map((device, index) => Object.freeze({
				deviceId: device.deviceId,
				label: device.label || `Audio output ${index + 1}`,
				groupId: device.groupId || '',
				isDefault: device.isDefault === true,
			})));
		}
		if (probe) {
			// A newer passive inventory must not cancel an explicit input probe.
			await Promise.allSettled(webInputs.map((device) => recordingCapturePool.acquireHardware(device.deviceId, {
				channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM,
				sampleRate: recordingInputSampleRate(),
			})));
			lifetime.signal.throwIfAborted();
			syncRecordingPoolSnapshot();
			if (!state.recorder) releaseUnretainedRecordingInputs();
			syncRecordingPoolSnapshot();
			if (!isCurrentInventory(generation)) return state.recordingDevices;
			updateRecordingDeviceRows(discoveredInputs);
			state.audioInputDevices = Object.freeze(state.recordingDevices.filter((device) => state.recordingEnumeratedDeviceIds.has(device.deviceId)).map((device) => Object.freeze({
				deviceId: device.deviceId,
				isDefault: device.isDefault === true, groupId: device.groupId ?? '',
				label: device.label,
				channelCount: device.channelCount,
				status: device.status,
			})));
		}
		await reconcilePreferredOutputDevice(generation);
		if (!isCurrentInventory(generation)) return state.recordingDevices;
		if (publish) publishDocumentSnapshot();
		return state.recordingDevices;
	}

	function isCurrentInventory(generation: number) {
		return !lifetime.inactive && generation === inventoryGeneration;
	}

	async function setPreferredInputDevice(deviceId: string) {
		const normalized = normalizePreferredInputDeviceId(deviceId);
		if (normalized !== RECORDING_DEFAULT_DEVICE_ID
			&& normalized !== RECORDING_DISPLAY_SOURCE_KEY
			&& !state.audioInputDevices.some((device) => device.deviceId === normalized)) {
			throw new Error('The selected audio input is unavailable.');
		}
		if (normalized === RECORDING_DISPLAY_SOURCE_KEY && !supportsDisplayAudioCapture(mediaDevices)) {
			throw new Error('Display audio capture is not supported in this browser.');
		}
		await keepSelectedRecordingInputsOpen();
		const previousDeviceId = state.preferredInputDeviceId;
		state.preferredInputDeviceId = normalized;
		await Promise.all([persistAudioDevicePreferences(), updatePreferredRecordingRoutes(previousDeviceId)]);
		if (normalized !== RECORDING_DISPLAY_SOURCE_KEY && (state.audioHost === 'browser' || state.audioHost === 'electron')) {
			await recordingCapturePool.acquireHardware(normalized, {
				channelCount: state.preferredInputChannelCount,
				sampleRate: recordingInputSampleRate(),
			});
		}
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return normalized;
	}

	async function configureDisplayInput() {
		if (!supportsDisplayAudioCapture(mediaDevices)) throw new Error('Display audio capture is not supported in this browser.');
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) {
			throw new Error('The display source cannot be changed while recording is active.');
		}
		await keepSelectedRecordingInputsOpen();
		const hasDisplay = Boolean(recordingCapturePool.getDisplay?.());
		const stream = hasDisplay && typeof recordingCapturePool.replaceDisplay === 'function'
			? await recordingCapturePool.replaceDisplay()
			: await recordingCapturePool.acquireDisplay();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return stream;
	}

	function keepSelectedRecordingInputsOpen() {
		if (state.preferences.recording.retainInputs) return Promise.resolve(state.preferences);
		return updatePreferences({ recording: { retainInputs: true } });
	}

	async function setPreferredInputChannelCount(channelCount: number) {
		const normalized = Number(channelCount) === 2 ? 2 : 1;
		state.preferredInputChannelCount = normalized;
		await updatePreferredRecordingRoutes();
		publishDocumentSnapshot();
		await persistAudioDevicePreferences();
		return normalized;
	}

	function updatePreferredRecordingRoutes(previousDeviceId = state.preferredInputDeviceId) {
		const previous = state.recordingRouting;
		const armed = getProject()?.tracks.filter(track => track.armed) ?? [];
		const trackId = state.selectedTrackId ?? (armed.length === 1 ? armed[0].id : undefined);
		const route = trackId ? previous.routes[trackId] : null;
		const followsPrevious = route?.kind === 'display' ? previousDeviceId === RECORDING_DISPLAY_SOURCE_KEY
			: route?.deviceId === previousDeviceId;
		const followTrackId = !state.recorder && armed.length <= 1 && route?.channelStart === 0 && followsPrevious ? trackId : undefined;
		state.recordingRouting = preferredRecordingRoutes(previous, {
			deviceId: state.preferredInputDeviceId, channelCount: state.preferredInputChannelCount,
			deviceLabel: state.audioInputDevices.find(device => device.deviceId === state.preferredInputDeviceId)?.label ?? '',
		}, followTrackId);
		return previous === state.recordingRouting ? Promise.resolve() : persistRecordingRouting();
	}

	function recordingInputSampleRate() {
		return state.audioHost === 'browser' || state.audioHost === 'electron'
			? projectSampleRate() : state.preferredRecordingSampleRate;
	}

	async function setRecordingSampleRate(sampleRate: number) {
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) {
			throw new Error('The recording sample rate cannot be changed while recording is active.');
		}
		const normalized = normalizeRecordingSampleRate(sampleRate);
		if (normalized !== sampleRate) throw new RangeError('Recording sample rate must be an integer between 8000 and 768000 Hz.');
		if (state.audioHost !== 'browser' && state.audioHost !== 'electron') {
			await engine.getAudioContext?.({ resume: false, sampleRate: normalized });
		}
		state.preferredRecordingSampleRate = normalized;
		await persistAudioDevicePreferences();
		publishDocumentSnapshot();
		return normalized;
	}

	async function setHostInventory(host: string, report: NativeAudioInventoryReport | null) {
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) {
			throw new Error('The audio host cannot be changed while recording is active.');
		}
		const normalized = host.trim();
		if (!normalized) throw new TypeError('An audio host is required.');
		const inventory = report ? adaptNativeAudioInventory(report) : null;
		if (inventory && inventory.backend !== normalized) throw new TypeError('The inventory must belong to the selected audio host.');
		const changed = state.audioHost !== normalized;
		const previousDeviceId = state.preferredInputDeviceId;
		if (changed) {
			recordingCapturePool.releaseAll();
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
		}
		state.audioHost = normalized;
		await refreshAudioDevices({ probe: false, publish: false, nativeInventory: inventory });
		if (state.audioHost !== normalized) return state.audioHost;
		const webHost = normalized === 'browser' || normalized === 'electron';
		if (!state.audioInputDevices.some(device => device.deviceId === state.preferredInputDeviceId)) {
			state.preferredInputDeviceId = webHost ? RECORDING_DEFAULT_DEVICE_ID
				: (state.audioInputDevices.find(device => device.isDefault) ?? state.audioInputDevices[0])?.deviceId ?? RECORDING_DEFAULT_DEVICE_ID;
		}
		if (!state.audioOutputDevices.some(device => device.deviceId === state.preferredOutputDeviceId)) {
			state.preferredOutputDeviceId = webHost ? ''
				: (state.audioOutputDevices.find(device => device.isDefault) ?? state.audioOutputDevices[0])?.deviceId ?? '';
		}
		await Promise.all([persistAudioDevicePreferences(), updatePreferredRecordingRoutes(previousDeviceId)]);
		await reconcilePreferredOutputDevice();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return normalized;
	}

	async function setAudioOutputDevice(deviceId: string) {
		const normalized = normalizePreferredOutputDeviceId(deviceId);
		if (normalized && !state.audioOutputDevices.some((device) => device.deviceId === normalized)) {
			throw new Error('The selected audio output is unavailable.');
		}
		const generation = ++outputDeviceSelectionGeneration;
		const previous = state.preferredOutputDeviceId;
		if (normalized.startsWith('native:')) {
			state.preferredOutputDeviceId = normalized;
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'available';
			await persistAudioDevicePreferences();
			if (generation === outputDeviceSelectionGeneration) publishDocumentSnapshot();
			return normalized;
		}
		try {
			const result = await Promise.resolve(engine.setOutputDevice?.(normalized));
			if (generation !== outputDeviceSelectionGeneration) return normalized;
			state.preferredOutputDeviceId = normalized;
			state.activeOutputDeviceId = result?.activeDeviceId ?? normalized;
			state.audioOutputStatus = normalized ? 'active' : 'default';
			await persistAudioDevicePreferences();
			if (generation === outputDeviceSelectionGeneration) publishDocumentSnapshot();
			return normalized;
		} catch (error) {
			if (generation === outputDeviceSelectionGeneration) {
				const errorName = (error as Readonly<{ name?: string }> | null)?.name;
				state.preferredOutputDeviceId = previous;
				state.audioOutputStatus = errorName === 'NotSupportedError'
					? 'unsupported'
					: errorName === 'NotAllowedError' || errorName === 'SecurityError'
						? 'denied'
						: 'error';
				publishDocumentSnapshot();
			}
			throw error;
		}
	}

	async function reconcilePreferredOutputDevice(expectedInventory?: number) {
		const generation = outputDeviceSelectionGeneration;
		const isCurrent = () => !lifetime.inactive && generation === outputDeviceSelectionGeneration
			&& (expectedInventory === undefined || isCurrentInventory(expectedInventory));
		if (!isCurrent()) return;
		const preferred = state.preferredOutputDeviceId;
		if (!preferred) {
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
			if (!isCurrent()) return;
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'default';
			return;
		}
		const available = state.audioOutputDevices.some((device) => device.deviceId === preferred);
		if (!available) {
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
			if (!isCurrent()) return;
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'unavailable';
			return;
		}
		if (preferred.startsWith('native:')) {
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'available';
			return;
		}
		try {
			const result = await Promise.resolve(engine.setOutputDevice?.(preferred));
			if (!isCurrent()) return;
			state.activeOutputDeviceId = result?.activeDeviceId ?? preferred;
			state.audioOutputStatus = 'active';
		} catch (error) {
			if (!isCurrent()) return;
			const errorName = (error as Readonly<{ name?: string }> | null)?.name;
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
			if (!isCurrent()) return;
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = errorName === 'NotSupportedError' ? 'unsupported' : 'denied';
		}
	}

	function persistAudioDevicePreferences() {
		return persistSetting(productSettingKey(AUDIO_DEVICE_PREFERENCES_SETTING_KEY), {
			host: state.audioHost,
			recordingSampleRate: state.preferredRecordingSampleRate,
			inputDeviceId: state.preferredInputDeviceId,
			inputChannelCount: state.preferredInputChannelCount,
			outputDeviceId: state.preferredOutputDeviceId,
		});
	}

	function updateRecordingDeviceRows(discovered: readonly RecordingRoutingDeviceRow[] = state.recordingDevices) {
		const rows = new Map<string, RecordingRoutingDeviceRow>();
		for (const device of discovered || []) {
			if (!device?.deviceId) continue;
			rows.set(device.deviceId, { ...device });
		}
		for (const route of Object.values(state.recordingRouting.routes || {})) {
			if (route.kind !== 'device' || rows.has(route.deviceId)) continue;
			rows.set(route.deviceId, {
				deviceId: route.deviceId,
				label: route.deviceLabel || (route.deviceId === RECORDING_DEFAULT_DEVICE_ID ? 'Default audio input' : 'Missing audio input'),
			});
		}
		for (const source of state.recordingPoolSources) {
			if (source.kind !== 'device' || !source.deviceId) continue;
			const existing = rows.get(source.deviceId) || { deviceId: source.deviceId, label: '' };
			rows.set(source.deviceId, { ...existing, channelCount: source.channelCount });
		}
		state.recordingDevices = Object.freeze([...rows.values()].map((device) => Object.freeze({
			deviceId: device.deviceId,
			label: device.label || (device.deviceId === RECORDING_DEFAULT_DEVICE_ID ? 'Default audio input' : 'Audio input'),
			groupId: device.groupId || '',
			isDefault: device.isDefault === true,
			channels: Object.freeze([...(device.channels || [])]),
			channelCount: Math.max(0, Number(device.channelCount) || 0),
			status: state.recordingPoolSources.some((source) => source.key === `device:${device.deviceId}`)
				? 'open'
				: state.recordingEnumeratedDeviceIds.has(device.deviceId) || device.deviceId === RECORDING_DEFAULT_DEVICE_ID
					? 'available'
					: 'unavailable',
		})));
	}

	function uniqueDeviceRows<Device extends RecordingRoutingDeviceRow>(devices: readonly Device[]): Device[] {
		const rows = new Map<string, Device>();
		for (const device of devices) {
			if (device?.deviceId && !rows.has(device.deviceId)) rows.set(device.deviceId, device);
		}
		return [...rows.values()];
	}

	async function setRecordingSourceLatency(sourceKey: string, value: number) {
		state.recordingRouting = setRecordingSourceOffset(state.recordingRouting, sourceKey, value);
		publishDocumentSnapshot();
		await persistRecordingRouting();
		return state.recordingRouting.offsets[sourceKey];
	}

	async function setRetainInputs(enabled: boolean) {
		const retainInputs = Boolean(enabled);
		await updatePreferences({ recording: { retainInputs } });
		if (retainInputs) state.recordingReleaseAfterStop = false;
		else if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) {
			state.recordingReleaseAfterStop = true;
		}
		else releaseUnretainedRecordingInputs();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return retainInputs;
	}

	function releaseInputs() {
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recordingFinishing) return false;
		if (state.microphoneMetering) {
			state.microphoneMetering = false;
			invalidateMicrophoneMeter();
			stopMicrophoneMetering({ releaseInput: false });
			void persistSetting('microphone-metering', false);
		}
		const released = recordingCapturePool.releaseAll();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return released;
	}

	function releaseUnretainedRecordingInputs({ force = false }: Readonly<{ readonly force?: boolean }> = {}) {
		if (!force && state.preferences.recording.retainInputs) return false;
		if (!state.microphoneMetering) return recordingCapturePool.releaseAll();
		const meterDeviceId = getMicrophoneMeterSession()?.deviceId || microphoneMeterDeviceId();
		let released = false;
		for (const source of recordingCapturePool.getSnapshot?.() || []) {
			if (source.kind === 'display') {
				released = recordingCapturePool.releaseDisplay() || released;
			} else if (source.kind === 'device' && source.deviceId && source.deviceId !== meterDeviceId) {
				released = recordingCapturePool.releaseHardware(source.deviceId) || released;
			}
		}
		return released;
	}

	function syncRecordingPoolSnapshot() {
		state.recordingPoolSources = Object.freeze(recordingCapturePool.getSnapshot?.() || []);
		if (!state.recorder) {
			const open = new Map(state.recordingPoolSources.map((source) => [source.key, source]));
			for (const [trackId, route] of Object.entries(state.recordingRouting.routes || {})) {
				const previous = state.recordingRouteHealth[trackId];
				const source = open.get(recordingRouteSourceKey(route));
				state.recordingRouteHealth[trackId] = source
					? route.kind === 'display' || route.channelStart + route.channelCount <= source.channelCount ? 'open' : 'skipped'
					: previous === 'disconnected' ? 'disconnected' : 'unavailable';
			}
		}
		updateRecordingDeviceRows();
	}
	return Object.freeze({
		loadRecordingRouting,
		persistRecordingRouting,
		requestInputAccess,
		refreshRecordingInputs,
		refreshAudioDevices,
		setPreferredInputDevice,
		configureDisplayInput,
		keepSelectedRecordingInputsOpen,
		setPreferredInputChannelCount,
		setRecordingSampleRate,
		setHostInventory,
		setAudioOutputDevice,
		reconcilePreferredOutputDevice,
		persistAudioDevicePreferences,
		updateRecordingDeviceRows,
		setRecordingSourceLatency,
		setRetainInputs,
		releaseInputs,
		releaseUnretainedRecordingInputs,
		syncRecordingPoolSnapshot,
	});
}
