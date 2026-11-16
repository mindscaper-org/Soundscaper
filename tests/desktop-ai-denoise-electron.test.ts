/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import test from 'node:test';
import { build } from 'esbuild';

const required = ['SCAPE_AI_DENOISE_TEST_RUNTIME_ROOT', 'SCAPE_AI_DENOISE_TEST_MANIFEST', 'SCAPE_AI_DENOISE_TEST_MODEL', 'SCAPE_AI_DENOISE_TEST_AUDIO'];
for (const rate of [48000, 44100, 96000]) for (const channels of [1, 2]) test(`real Electron utility ports sustain ${channels === 1 ? 'mono' : 'stereo'} denoising at ${rate} Hz during a UI stall`, {
	skip: process.platform !== 'linux' || required.some(key => !process.env[key]), timeout: 90_000,
}, async t => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-ai-denoise-'));
	try {
		await build({ entryPoints: { main: 'tests/electron/ai-denoise-main.mjs', helper: 'desktop/ai-denoise-helper-process.ts' },
			outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', external: ['electron'] });
		await build({ entryPoints: ['tests/electron/ai-denoise-preload.cjs'], outfile: join(directory, 'preload.cjs'),
			bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
		await build({ entryPoints: ['src/common/editor/first-party-effects/ai-denoise/worklet.ts'], outfile: join(directory, 'worklet.js'),
			bundle: true, platform: 'browser', format: 'esm' });
		await writeFile(join(directory, 'capture.js'), `class Capture extends AudioWorkletProcessor {
			constructor(){super();this.frames=0;this.energy=0;this.finite=true;}
			process(inputs,outputs){for(const plane of inputs[0]||[])for(const x of plane){this.energy+=x*x;this.finite&&=Number.isFinite(x);}
			this.frames+=128;if(this.frames%12800===0)this.port.postMessage({frames:this.frames,energy:this.energy,finite:this.finite});
			for(const plane of outputs[0]||[])plane.fill(0);return true;}}
			registerProcessor('denoise-capture',Capture);`);
		await writeFile(join(directory, 'index.html'), `<!doctype html><script type="module">
			try {
			const context=new AudioContext({sampleRate:${rate}}); await context.suspend();
			await context.audioWorklet.addModule('/worklet.js');await context.audioWorklet.addModule('/capture.js');
			const node=new AudioWorkletNode(context,'kw-ai-denoise',{outputChannelCount:[${channels}],channelCount:${channels},
				channelCountMode:'explicit',processorOptions:{channelCount:${channels}}});
			const decoded=await context.decodeAudioData(await (await fetch('/speech.wav')).arrayBuffer());
			const buffer=context.createBuffer(${channels},decoded.length,${rate});for(let c=0;c<${channels};c++)buffer.copyToChannel(decoded.getChannelData(c%decoded.numberOfChannels),c);
			const capture=new AudioWorkletNode(context,'denoise-capture',{channelCount:${channels}});
			let failed=false,stalled=false,metrics;const finish=value=>{if(failed)return;failed=true;node.port.postMessage({type:'dispose'});window.denoiseTest.result({...value,metrics});};
			node.port.onmessage=({data})=>{if(data.type==='error')finish({error:data.message});};
			capture.port.onmessage=({data})=>{if(data.frames>=${rate}&&!stalled){stalled=true;const end=performance.now()+500;while(performance.now()<end){}}
				if(data.frames>=${rate * 3})finish({...data,stalled});};
			const pair=new MessageChannel();pair.port2.onmessage=({data})=>{if(data.type==='ready'){metrics=data.metrics;
				node.port.postMessage({type:'attach'},[pair.port2]);node.connect(capture).connect(context.destination);
				const source=context.createBufferSource();source.buffer=buffer;source.connect(node);source.start();void context.resume();
			}else finish({error:data.message});};pair.port2.start();
			window.postMessage({type:'soundscaper-ai-denoise-connect-v1',request:{sessionId:'a'.repeat(40),sampleRate:48000,channelCount:${channels}}},location.origin,[pair.port1]);
			} catch(error){window.denoiseTest.result({error:String(error)});}
			</script>`);
		const executable = createRequire(import.meta.url)('electron') as string;
		const environment: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '' };
		delete environment.ELECTRON_RUN_AS_NODE;
		const { stdout } = await promisify(execFile)('xvfb-run', ['-a', executable, '--no-sandbox', join(directory, 'main.mjs')],
			{ timeout: 80_000, maxBuffer: 1024 ** 2, env: environment });
		const line = stdout.split('\n').find(value => value.startsWith('AI_DENOISE_RESULT:'));
		assert.ok(line, stdout);
		const result = JSON.parse(line.slice('AI_DENOISE_RESULT:'.length)) as { error?: string; frames: number; energy: number; finite: boolean; stalled: boolean };
		t.diagnostic(JSON.stringify(result));
		assert.equal(result.error, undefined);
		assert.ok(result.frames >= rate * 3); assert.ok(result.energy > 1, JSON.stringify(result)); assert.equal(result.finite, true); assert.equal(result.stalled, true);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
