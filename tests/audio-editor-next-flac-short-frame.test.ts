/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createController, createTwoTrackFixture, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';

const runNode = promisify(execFile);

async function encodedConstant(frames: number, value: number): Promise<Uint8Array<ArrayBuffer>> {
	const pcm = new Float32Array(frames).fill(value);
	return encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(pcm.buffer), frameCount: frames,
		sampleRate: 48_000, channelCount: 1, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
}

for (const value of [0, .25]) test(`File Open retains the final constant FLAC frame (${value})`, async () => {
	const bytes = await encodedConstant(4800, value);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => input instanceof URL && input.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(input))) : originalFetch(input, init);
	const { store } = await createTwoTrackFixture('next-flac-short-frame', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([bytes], 'Constant.flac', { type: 'audio/flac' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1);
		const source = project.sources[0]!;
		assert.equal(source.frameCount, 4800, 'the final704 samples must survive import');
		assert.deepEqual(await storedChannel(store, source.id, 0), new Float32Array(4800).fill(value));
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
});

test('a single short constant FLAC frame completes import rather than spinning forever', async () => {
	const bytes = await encodedConstant(128, .25);
	// A separate process bounds the original demuxer's non-yielding microtask loop.
	const script = `
		import {readFile} from 'node:fs/promises';
		import {prepareStreamedAudioImport} from './src/common/editor/browser-streamed-audio-import.ts';
		const originalFetch=globalThis.fetch;
		globalThis.fetch=async(input,init)=>input instanceof URL&&input.protocol==='file:'
			?new Response(Uint8Array.from(await readFile(input))):originalFetch(input,init);
		const file=new File([Uint8Array.from(Buffer.from(process.argv[1],'base64'))],'Single.flac',{type:'audio/flac'});
		const prepared=await prepareStreamedAudioImport(file);
		let frames=0;
		await prepared.stream({chunkFrames:65536,onChunk(channels){
			for(const value of channels[0])if(value!==.25)throw new Error('Changed PCM');
			frames+=channels[0].length;
		}});
		const bytes=new Uint8Array(await file.arrayBuffer());
		let end=4;
		for(;;){const last=bytes[end]&128;end+=4+(bytes[end+1]<<16|bytes[end+2]<<8|bytes[end+3]);if(last)break;}
		let emptyRefused=false;
		try{await prepareStreamedAudioImport(file.slice(0,end));}catch{emptyRefused=true;}
		console.log(JSON.stringify({frames,declared:prepared.descriptor.frameCount,emptyRefused}));
	`;
	const { stdout } = await runNode(process.execPath,
		['--import', 'tsx', '--import', './scripts/node-style-asset-loader.mjs', '--input-type=module', '-e', script,
			Buffer.from(bytes).toString('base64')], { timeout: 10_000, killSignal: 'SIGKILL' });
	assert.deepEqual(JSON.parse(stdout) as unknown, { frames: 128, declared: 128, emptyRefused: true });
});

for (const bundle of ['mediabunny.cjs', 'mediabunny.node.cjs', 'mediabunny.mjs']) {
	test(`the shipped ${bundle} consumer preserves short FLAC packet geometry`, async () => {
		const bytes = await encodedConstant(4800, .25);
		const { stdout } = await runNode(process.execPath, ['--input-type=module', '-e', `
			const module=await import('./node_modules/mediabunny/dist/bundles/'+process.argv[1]);
			const {Input,BlobSource,ALL_FORMATS,EncodedPacketSink}=module.default??module;
			const input=new Input({source:new BlobSource(new Blob([Buffer.from(process.argv[2],'base64')])),formats:ALL_FORMATS});
			try {
				const track=await input.getPrimaryAudioTrack();
				if(!track)throw new Error('No FLAC track');
				let frames=0;
				for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true})){
					frames+=Math.round(packet.duration*48000);
				}
				console.log(JSON.stringify({frames,durationFrames:Math.round(await track.computeDuration()*48000)}));
			}finally{input.dispose();}
		`, bundle, Buffer.from(bytes).toString('base64')], { timeout: 10_000, killSignal: 'SIGKILL' });
		assert.deepEqual(JSON.parse(stdout) as unknown, { frames: 4800, durationFrames: 4800 });
	});
}
