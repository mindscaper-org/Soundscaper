/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';

for (const [channelCount, channelMask] of [[2, 5], [2, 9], [2, 0x30]] as const) {
	test(`Original refuses an unrepresentable ${String(channelCount)}-channel WAVE mask ${String(channelMask)}`, async () => {
		const channels = Array.from({ length: channelCount }, () => Float32Array.of(.125, -.0625));
		const file = new File([new Uint8Array(encodeWav(channels, { sampleRate: 48_000, bitDepth: 20, channelMask, dither: false })).buffer], 'Roles.wav');
		const descriptor = await inspectWavBlobPcm(file);
		assert.equal(descriptor.channelMask, channelMask);
		const original = channels.map(channel => channel.slice());
		assert.equal(await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', ...descriptor }]), null);
		assert.deepEqual(channels, original);
	});
}
for (const [channelCount, channelMask] of [[2, 3], [2, 0]] as const) {
	test(`Original keeps its admitted ${String(channelCount)}-channel WAVE mask ${String(channelMask)} profile`, async () => {
		const channels = Array.from({ length: channelCount }, () => Float32Array.of(.125, -.0625));
		const file = new File([new Uint8Array(encodeWav(channels, { sampleRate: 48_000, bitDepth: 20, channelMask, dither: false })).buffer], 'Roles.wav');
		const descriptor = await inspectWavBlobPcm(file);
		const settings = await resolveDesktopOriginalExportSettings(file, [{ kind: 'audio', ...descriptor }]);
		assert.ok(settings); assert.equal(settings.sampleFormat, 'int20');
		assert.equal(settings.channelMapping, 'stereo');
	});
}
