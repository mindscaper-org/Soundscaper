/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const [rightGain, pan] of [[.25, 0], [.25, .5], [.25, -.5], [1, 0]] as const) {
	test(`legacy linked stereo retains each channel envelope when right gain is ${rightGain} and pan is ${pan}`, async context => {
		const frames = 4800, bytes = new Uint8Array(24 + frames * 4), view = new DataView(bytes.buffer);
		for (const [index, value] of [0x2e736e64, 24, frames * 4, 6, 48_000, 1].entries()) view.setUint32(index * 4, value);
		for (let frame = 0; frame < frames; frame++) view.setFloat32(24 + frame * 4, .1);
		const channel = (index: number, gain: number): string => `<wavetrack name="Stereo" channel="${index}" linked="${index === 0 ? 1 : 0}" rate="48000" gain="1" pan="${pan}"><waveclip name="Stereo" offset="0">`
			+ `<sequence numsamples="${frames}"><waveblock start="0"><simpleblockfile filename="e000${index}.au" len="${frames}"/></waveblock></sequence>`
			+ `<envelope numpoints="2"><controlpoint t="0" val="${gain}"/><controlpoint t=".1" val="${gain}"/></envelope></waveclip></wavetrack>`;
		const xml = `<project rate="48000">${channel(0, 1)}${channel(1, rightGain)}</project>`;
		const native = createNodeWebAudioEngineFactory(context);
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: native.createEngine(), ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		await controller.ready;
		try {
			await controller.actions.project.importFiles([new File([xml], 'Stereo envelopes.aup'),
				new File([bytes], 'e0000.au'), new File([bytes], 'e0001.au')]);
			const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
			assert.equal(project.clips.length, rightGain === 1 ? 1 : 2, 'different channel envelopes must remain independently audible');
			const audioClips = project.clips.filter(clip => clip.kind === 'audio');
			assert.deepEqual(audioClips.map(clip => clip.envelope[0]?.value).sort(), rightGain === 1 ? [1] : [.25, 1]);
			if (rightGain !== 1) {
				assert.deepEqual(project.tracks.filter(track => track.type === 'audio').map(track => track.pan),
					[pan > 0 ? 2 * pan - 1 : -1, pan < 0 ? 2 * pan + 1 : 1]);
				assert.ok(audioClips[0]?.groupId); assert.equal(audioClips[0].groupId, audioClips[1]?.groupId);
				assert.deepEqual(project.tracks.map(track => track.name), ['Stereo', 'Stereo']);
				assert.match(JSON.stringify(project.opaqueExtensions), /Independent channel envelopes/u);
			}
			for (const source of project.sources) {
				assert.ok(source.kind === 'audio'); const chunk = await store.readSourceChunk(source.storageKey, 0); assert.ok(chunk);
				for (const channel of chunk.channels) assert.equal(channel[1000], Math.fround(.1));
			}
			await controller.actions.project.flush();
			const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved));
			assert.deepEqual(saved.clips, project.clips); assert.deepEqual(saved.tracks, project.tracks);
			const reopened = await assertAudioProjectArchivePcm(context, store, project, (_name, channels) => {
				for (const channel of channels) {
					assert.equal(channel.length, frames);
					assert.ok(channel.every(sample => sample === Math.fround(.1)));
				}
			});
			const renderer = native.createEngine();
			try {
				const buffers = new Map<string, AudioBuffer>();
				for (const source of reopened.sources) {
					assert.ok(source.kind === 'audio');
					const buffer = await store.loadSourceAudioBuffer(source.storageKey, await renderer.getAudioContext({ resume: false }));
					assert.ok(buffer instanceof AudioBuffer); buffers.set(source.id, buffer);
				}
				renderer.loadProject(projectForRuntimeConsumers(reopened), buffers);
				const output = await renderer.renderMix({ startFrame: 0, endFrame: frames }); assert.ok(output instanceof AudioBuffer);
				assert.deepEqual([output.length, output.sampleRate, output.numberOfChannels], [frames, 48_000, 2]);
				const left = pan > 0 ? .1 * Math.cos(pan * Math.PI / 2) : .1 + .1 * rightGain * Math.cos((pan + 1) * Math.PI / 2);
				const right = pan < 0 ? .1 * rightGain * Math.sin((pan + 1) * Math.PI / 2) : .1 * rightGain + .1 * Math.sin(pan * Math.PI / 2);
				for (const [channel, expected] of [left, right].entries()) for (let frame = 256; frame < frames - 256; frame++) {
					assert.ok(Math.abs(output.getChannelData(channel)[frame]! - expected) < 1e-7, `channel ${channel}, frame ${frame}`);
				}
			} finally { await renderer.dispose(); }
		} finally { await controller.dispose(); await native.dispose(); }
	});
}
