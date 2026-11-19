/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';

for (const reuseWideWindow of [false, true]) test(
	`exact warp audition stops at the selected sample with a ${reuseWideWindow ? 'previously prepared' : 'fresh'} window`,
	async context => {
		const native = createNodeWebAudioEngineFactory(context);
		// Keep transport UI polling independent of the audio boundary.
		const engine = native.createEngine({ audioWarpRealtimeAcceleration: false, meterInterval: 300 });
		const { controller } = await controllerSession(context, { engine,
			engineFactory: options => native.createEngine({ ...options, audioWarpRealtimeAcceleration: false }) });
		const scratch = await mkdtemp(join(tmpdir(), 'goal-warp-audition.'));
		context.after(async () => { await rm(scratch, { recursive: true }); });
		const input = new Float32Array(48_000).fill(.8);
		input.fill(.08, 0, 9600);
		const wav = encodeWav([input], { sampleRate: 48_000, float: true }); assert.ok(wav instanceof Uint8Array);
		const path = join(scratch, 'Quiet range loud remainder.wav');
		await writeFile(path, wav);
		await controller.actions.project.importFiles([new File([Uint8Array.from(await readFile(path))],
			'Quiet range loud remainder.wav', { type: 'audio/wav' })], { destination: 'timeline' });
		const [clip] = clipboardProject(controller.project).clips; assert.ok(clip?.kind === 'audio');
		const trackId = controller.getSnapshot().selectedTrackId; assert.ok(trackId);
		controller.actions.timeline.selectClip(clip.id);
		await controller.actions.audioWarp.createIdentityMap();
		assert.ok(clipboardProject(controller.project).clips[0]?.warpMap);
		assert.equal(engine.getAudioWarpRenderStatus().path, 'exact-offline');
		const audio = await engine.getAudioContext();
		assert.ok(audio instanceof AudioContext);
		const tap = audio.createScriptProcessor(256, 2, 1);
		const output = engine.getPlaybackDestination(); assert.ok(output);
		output.connect(tap); tap.connect(audio.destination);
		let quietFrames = 0, loudFrames = 0;
		tap.onaudioprocess = ({ inputBuffer }) => {
			const pcm = inputBuffer.getChannelData(0);
			for (const value of pcm) {
				if (Math.abs(value) > 0.3) loudFrames++;
				else if (Math.abs(value) > 0.01) quietFrames++;
			}
		};
		try {
			await controller.actions.timeline.setExactSelection(4800, 9600, { trackIds: [trackId] });
			if (reuseWideWindow) {
				await controller.actions.transport.playPause();
				assert.equal(engine.getState().playbackEndFrame, 48_000);
				engine.setPlayRange({ startFrame: 4800, endFrame: 9600, overrideLoop: true });
				controller.actions.transport.seek(4800);
				for (let check = 0; check < 100 && engine.getState().playbackEndFrame !== 9600; check++)
					await new Promise(resolve => setTimeout(resolve, 10));
			} else await controller.actions.transport.playSelection();
			const started = engine.getState();
			assert.equal(started.playbackStartFrame, 4800);
			assert.equal(started.playbackEndFrame, 9600);
			for (let check = 0; check < 100 && engine.getState().state === 'playing'; check++)
				await new Promise(resolve => setTimeout(resolve, 10));
			await new Promise(resolve => setTimeout(resolve, 35));
			assert.equal(engine.getState().state, 'stopped');
			assert.equal(engine.getState().positionFrame, 9600);
			assert.ok(quietFrames >= 3500);
			assert.equal(loudFrames, 0, 'nothing after the authored end may reach the listening graph');
		} finally {
			tap.onaudioprocess = null;
			output.disconnect(tap);
			tap.disconnect();
		}
	});
