/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { BlobSource, Input, FLAC } from 'mediabunny';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';

for (const sampleRate of [64_000, 48_000, 44_101, 38_410]) test(`FLAC exported at ${String(sampleRate)}Hz retains every frame on packet import`, async () => {
	const channels = Float32Array.from({ length: 6400 }, (_, frame) => ((frame % 101) - 50) * 127 / 32768);
	const encoded = await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(channels.buffer), frameCount: channels.length,
		channelCount: 1, sampleRate, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	const file = new File([Uint8Array.from(encoded)], 'Roundtrip.flac', { type: 'audio/flac' });
	const input = new Input({ source: new BlobSource(file), formats: [FLAC] });
	try { assert.equal(Math.round(await input.computeDuration() * sampleRate), channels.length); } finally { input.dispose(); }
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async url => { assert.ok(url instanceof URL); return new Response(Uint8Array.from(await readFile(url))); };
	try {
		const prepared = await prepareStreamedAudioImport(file);
		try {
			assert.equal(prepared.descriptor.frameCount, channels.length);
			const actual: number[] = [];
			await prepared.stream({ chunkFrames: 1024, onChunk(chunk) { actual.push(...chunk[0]!); } });
			assert.deepEqual(actual, [...channels]);
		} finally { prepared.dispose(); }
	} finally { globalThis.fetch = originalFetch; }
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) test(`shipped ${bundle} retains FLAC frame clocks in kilohertz`, async () => {
	const pcm = new Float32Array(6400).fill(.125);
	const encoded = await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		channelCount: 1, sampleRate: 64_000, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
		const imported=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
		const {Input,BlobSource,FLAC}=imported.default??imported;
		const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:[FLAC]});
		try{console.log(await input.computeDuration());}finally{input.dispose();}
	`, bundle, Buffer.from(encoded).toString('base64')], { timeout: 10_000 });
	assert.equal(Number(stdout) * 64_000, pcm.length);
});
