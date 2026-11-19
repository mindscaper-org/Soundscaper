/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createNativeDeviceJobRunner, NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE } from '../desktop/native-helper-process.js';
import {
	MAXIMUM_NATIVE_AUDIO_DEVICES,
	validateHelperAudioDeviceInventoryResult,
} from '../desktop/native-helper-results.ts';

test('the professional addon inventory statuses pass desktop admission', async () => {
	const speakers = { handle: 'Speakers (USB Audio)', label: 'Speakers (USB Audio)', direction: 'output' };
	const runner = createNativeDeviceJobRunner({
		addonPath: '/unused', addonSha256: 'f'.repeat(64), hash: () => createHash('sha256'),
		loadAddon: async () => ({
			enumerateAudioBackends: () => [
				{ backend: 'wasapi', status: 'ok', detail: '', devices: [speakers] },
				{ backend: 'asio', status: 'backend-unavailable', detail: 'backend-unavailable', devices: [] },
				{ backend: 'pipewire', status: 'server-unavailable', detail: 'server-unavailable', devices: [] },
				{ backend: 'jack', status: 'unsupported', detail: 'unsupported', devices: [] },
			],
		}),
	});
	const inventory = async (backend: string) => validateHelperAudioDeviceInventoryResult(await runner({
		grant: { backend, direction: 'duplex', mode: 'shared', deviceHandle: NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE },
		onProgress: () => {},
	}).completion);

	assert.deepEqual(await inventory('wasapi'), { backend: 'wasapi', status: 'available', detail: '', devices: [speakers] });
	assert.deepEqual(await inventory('asio'), { backend: 'asio', status: 'backend-absent', detail: 'backend-unavailable', devices: [] });
	assert.deepEqual(await inventory('pipewire'), { backend: 'pipewire', status: 'server-absent', detail: 'server-unavailable', devices: [] });
	assert.deepEqual(await inventory('jack'), { backend: 'jack', status: 'unsupported-platform', detail: 'unsupported', devices: [] });
});

test('a WASAPI input and output can share the endpoint name used to open them', () => {
	const devices = [
		{ handle: 'USB Audio', label: 'USB Audio', direction: 'output' },
		{ handle: 'USB Audio', label: 'USB Audio', direction: 'input' },
	];
	assert.deepEqual(validateHelperAudioDeviceInventoryResult({ backend: 'wasapi', status: 'available', detail: '', devices }).devices, devices);
});

test('backend defaults and directional channel counts survive inventory admission', async () => {
	const devices = [
		{ handle: 'DELL Display Audio', label: 'DELL Display Audio', direction: 'output', channelCount: 2 },
		{ handle: 'Focusrite USB Audio', label: 'Focusrite USB Audio', direction: 'output', channelCount: 2, isDefault: true },
		{ handle: 'Focusrite USB Audio', label: 'Focusrite USB Audio', direction: 'input', channelCount: 8, isDefault: true },
	];
	const runner = createNativeDeviceJobRunner({
		addonPath: '/unused', addonSha256: 'f'.repeat(64), hash: () => createHash('sha256'),
		loadAddon: async () => ({
			enumerateAudioBackends: () => [{ backend: 'wasapi', status: 'ok', detail: '', devices }],
		}),
	});
	const answer = await runner({
		grant: { backend: 'wasapi', direction: 'duplex', mode: 'shared', deviceHandle: NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE },
		onProgress: () => {},
	}).completion;
	assert.deepEqual(validateHelperAudioDeviceInventoryResult(answer).devices, devices);
});

test('ALSA publishes its configured default PCM in both directions', async () => {
	const devices = [
		{ handle: 'auxiliary', label: 'Auxiliary monitor', direction: 'duplex' },
		{ handle: 'default', label: 'Configured recording and playback device', direction: 'duplex' },
	];
	const runner = createNativeDeviceJobRunner({
		addonPath: '/unused', addonSha256: 'f'.repeat(64), hash: () => createHash('sha256'),
		loadAddon: async () => ({ enumerateAudioBackends: () => [{ backend: 'alsa', status: 'ok', detail: '', devices }] }),
	});
	const answer = validateHelperAudioDeviceInventoryResult(await runner({
		grant: { backend: 'alsa', direction: 'duplex', mode: 'shared', deviceHandle: NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE },
		onProgress: () => {},
	}).completion);
	assert.deepEqual(answer.devices, [devices[0], { ...devices[1], isDefault: true }]);
});

test('an inventory result that contradicts itself or repeats a handle in the same direction is refused', () => {
	assert.throws(() => validateHelperAudioDeviceInventoryResult({
		backend: 'alsa',
		status: 'library-absent',
		detail: '',
		devices: [{ handle: 'hw:0,0', label: 'Built-in', direction: 'duplex' }],
	}), /not available must publish no devices/u);
	for (const [first, second] of [['input', 'input'], ['output', 'output'], ['duplex', 'input'], ['output', 'duplex']]) {
		assert.throws(() => validateHelperAudioDeviceInventoryResult({
			backend: 'alsa',
			status: 'available',
			detail: '',
			devices: [
				{ handle: 'hw:0,0', label: 'A', direction: first },
				{ handle: 'hw:0,0', label: 'B', direction: second },
			],
		}), /same device handle twice/u);
	}
	assert.throws(() => validateHelperAudioDeviceInventoryResult({
		backend: 'alsa', status: 'invented', detail: '', devices: [],
	}), /known backend status/u);
	assert.throws(() => validateHelperAudioDeviceInventoryResult({
		backend: 'alsa',
		status: 'available',
		detail: '',
		devices: Array.from({ length: MAXIMUM_NATIVE_AUDIO_DEVICES + 1 }, (_, index) => ({
			handle: `hw:${String(index)}`, label: 'Device', direction: 'duplex',
		})),
	}), /at most 128 devices/u);
});
