/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { desktopCodecPreloadContext } from './helpers/desktop-codec-preload-context.ts';
import test from 'node:test';

interface StreamBridge { runDesktopAudioCodecStreamCommand(value: unknown): Promise<unknown>; }
const plan = { schemaVersion: 1, frameCount: 3600 * 48000, maximumOutputBytes: 1_000_000_000,
	tuple: { operation: 'audio-encode', format: 'mp3', sampleRate: 48000, channelCount: 2, settings: { bitrateKbps: 192 } } };
const operationId = `desktop-audio-stream-${'a'.repeat(32)}`;

async function preload(invoke: (channel: string, value: unknown) => Promise<unknown>): Promise<StreamBridge> {
	return desktopCodecPreloadContext<StreamBridge>(invoke);
}

test('sandbox preload admits one-hour PCM offsets and copies only bounded pathless stream packets', async () => {
	const calls: Array<{ channel: string; value: unknown }> = [];
	const bridge = await preload(async (channel, value) => { calls.push({ channel, value }); return true; });
	await bridge.runDesktopAudioCodecStreamCommand({ type: 'begin', plan });
	const bytes = new Uint8Array([1, 2, 3, 4]);
	await bridge.runDesktopAudioCodecStreamCommand({ type: 'write', operationId, offset: 1_382_400_000 - 4, bytes });
	assert.equal(calls.length, 2); assert.equal(calls[0]!.channel, 'soundscaper:v1:codecs:audio:stream');
	const transferred = calls[1]!.value as { offset: number; bytes: Uint8Array };
	assert.equal(transferred.offset, 1_382_400_000 - 4); assert.notEqual(transferred.bytes, bytes); assert.deepEqual(transferred.bytes, bytes);
	bytes.fill(9); assert.deepEqual(transferred.bytes, new Uint8Array([1, 2, 3, 4]));
});

test('sandbox preload rejects oversized or path-bearing stream commands before main IPC', async () => {
	let calls = 0; const bridge = await preload(async () => { calls++; return true; });
	const oversized = new ArrayBuffer(1024 ** 2 + 1);
	Object.defineProperty(oversized, 'slice', { value: () => { throw new Error('Oversized input must not be copied.'); } });
	await assert.rejects(() => bridge.runDesktopAudioCodecStreamCommand({ type: 'write', operationId, offset: 0, bytes: oversized }), /Oversized desktop audio stream packet/u);
	for (const command of [
		{ type: 'begin', plan: { ...plan, inputPath: '/renderer/input' } },
		{ type: 'begin', plan: { ...plan, maximumOutputBytes: Number.MAX_SAFE_INTEGER + 1 } },
		{ type: 'begin', plan: { ...plan, frameCount: plan.frameCount + 1 } },
		{ type: 'write', operationId, offset: 0, bytes: new Uint8Array(1024 ** 2 + 1) },
		{ type: 'read', operationId, offset: 0, maximumBytes: 1024 ** 2 + 1 },
		{ type: 'execute', operationId, outputPath: '/renderer/output' },
		{ type: 'delete', operationId: '../scratch' },
	]) await assert.rejects(() => bridge.runDesktopAudioCodecStreamCommand(command));
	assert.equal(calls, 0);
});
