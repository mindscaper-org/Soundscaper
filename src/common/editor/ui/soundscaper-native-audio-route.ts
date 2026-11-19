/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NativeAudioSessionOpenRequestV1 } from './soundscaper-native-services-bridge.ts';
import { nativeAudioDeviceId, type NativeAudioDeviceReport, type NativeAudioInventoryReport } from '../controller/recording/native-audio-inventory.ts';

export type NativeAudioStreamingUiBackend = Exclude<
	NativeAudioSessionOpenRequestV1['candidates'][number]['backend'], 'jack'
>;

export function isNativeAudioStreamingBackend(value: string): value is NativeAudioStreamingUiBackend {
	return ['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa'].includes(value);
}

/** A pin to input N needs all physical planes through N, independently of its mono/stereo output width. */
export function nativeAudioInputChannelDemand(preferredWidth: number, deviceId: string, routes: unknown): number {
	let required = preferredWidth || 1;
	if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return required;
	for (const candidate of Object.values(routes)) {
		const route: unknown = candidate;
		if (!route || typeof route !== 'object' || !('kind' in route) || route.kind !== 'device'
			|| !('deviceId' in route) || route.deviceId !== deviceId && route.deviceId !== 'default'
			|| !('channelStart' in route) || typeof route.channelStart !== 'number' || !Number.isSafeInteger(route.channelStart) || route.channelStart < 0
			|| !('channelCount' in route) || typeof route.channelCount !== 'number' || !Number.isSafeInteger(route.channelCount) || route.channelCount < 1) continue;
		required = Math.max(required, route.channelStart + route.channelCount);
	}
	return required;
}

/** Validate and freeze the exact native route form before it reaches the desktop bridge. */
export function createNativeAudioRouteOpenRequest(
	value: NativeAudioSessionOpenRequestV1,
): NativeAudioSessionOpenRequestV1 {
	if (value.candidates.length < 1 || value.candidates.length > 4
		|| value.candidates.some((candidate) => !isNativeAudioStreamingBackend(candidate.backend)
			|| !candidate.deviceHandle || /[\0/\\]/u.test(candidate.deviceHandle))
		|| !['input', 'output', 'duplex'].includes(value.direction)
		|| !['shared', 'exclusive'].includes(value.mode)
		|| value.candidates.some((candidate) => candidate.backend === 'asio') && value.mode !== 'exclusive') {
		throw new TypeError('Invalid native audio route selection.');
	}
	for (const [entry, minimum, maximum] of [
		[value.sampleRate, 8_000, 768_000], [value.periodFrames, 1, 16_384], [value.channelCount, 1, 32],
	] as const) if (!Number.isSafeInteger(entry) || entry < minimum || entry > maximum) {
		throw new RangeError('A native audio route value is outside its admitted bounds.');
	}
	return Object.freeze({
		candidates: Object.freeze(value.candidates.map((candidate) => Object.freeze({ ...candidate }))),
		direction: value.direction, mode: value.mode, sampleRate: value.sampleRate,
		periodFrames: value.periodFrames, channelCount: value.channelCount,
	});
}

export function routeRequests(host: string, inventory: NativeAudioInventoryReport, settings: Readonly<{ preferredInputDeviceId: string; preferredOutputDeviceId: string; recordingSampleRate: number }>, inputChannels: number): readonly NativeAudioSessionOpenRequestV1[] {
	if (!isNativeAudioStreamingBackend(host)) return [];
	const input = selectedDevice(inventory, 'input', settings.preferredInputDeviceId);
	const output = selectedDevice(inventory, 'output', settings.preferredOutputDeviceId);
	const sampleRate = settings.recordingSampleRate;
	// Keep the bounded WASAPI credit window at least as long as at 48 kHz.
	const periodFrames = host === 'wasapi' ? 256 * Math.ceil(sampleRate / 48_000) : 256;
	const request = (device: NativeAudioDeviceReport, direction: 'input' | 'output' | 'duplex', channelCount: number) => createNativeAudioRouteOpenRequest({
		candidates: [{ backend: host, deviceHandle: device.handle }], direction,
		// The native ALSA adapter grants direct hw: handles as exclusive streams.
		mode: host === 'asio' || (host === 'alsa' && device.handle.startsWith('hw:')) ? 'exclusive' : 'shared', sampleRate, periodFrames, channelCount,
	});
	const outputChannels = Math.min(2, output?.channelCount || 2);
	// ALSA opens a shared PCM name independently for capture and playback.
	if (host !== 'alsa' && input && output && input.handle === output.handle && inputChannels === outputChannels) return [request(input, 'duplex', inputChannels)];
	return [input ? request(input, 'input', inputChannels) : null, output ? request(output, 'output', outputChannels) : null]
		.filter((value): value is NativeAudioSessionOpenRequestV1 => value !== null);
}

export function selectedDevice(inventory: NativeAudioInventoryReport, direction: 'input' | 'output', deviceId: string): NativeAudioDeviceReport | undefined {
	const kind = direction === 'input' ? 'audio-input' : 'audio-output';
	const devices = inventory.devices.filter((device) => device.direction === direction || device.direction === 'duplex');
	return devices.find((device) => nativeAudioDeviceId(inventory.backend, kind, device.handle) === deviceId)
		?? devices.find((device) => device.isDefault) ?? devices[0];
}
