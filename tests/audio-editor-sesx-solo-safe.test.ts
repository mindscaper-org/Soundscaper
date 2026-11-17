/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { parseSesxDocument } from '../src/common/editor/sesx-import.ts';
import { buildSesxProject } from '../src/common/editor/sesx-import-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { sesxSoloSafeSession } from './helpers/sesx-solo-safe-fixture.ts';
import { sesxDesktopHardwareFixture } from './helpers/sesx-desktop-hardware-fixture.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { encodeWav } from '../src/common/editor/wav.js';

for (const solo of [false, true]) for (const safe of [false, true]) for (const muted of [false, true]) {
	test(`Audition solo-safe programme: solo=${String(solo)}, safe=${String(safe)}, mute=${String(muted)}`, async context => {
		const native = createNodeWebAudioEngineFactory(context);
		let ordinal = 0;
		const plan = buildSesxProject(parseSesxDocument(sesxSoloSafeSession(solo, safe, muted)), {
			createStableId: prefix => `${prefix}-${++ordinal}`, fileName: 'Solo-safe.sesx',
			media: new Map([['0', { frameCount: 4800, sampleRate: 48000, channelCount: 1 }]]),
		});
		const project = createSoundscaperProject(plan.project);
		const buffer = new AudioBuffer({ numberOfChannels: 1, length: 4800, sampleRate: 48000 });
		buffer.getChannelData(0).fill(.25);
		const engine = native.createEngine();
		engine.loadProject(projectForRuntimeConsumers(project), new Map([[project.sources[0]!.id, buffer as unknown as globalThis.AudioBuffer]]));
		const output = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }));
		await engine.dispose();
		assert.equal(output.some(channel => channel.some(value => Math.abs(value) > .01)), !muted && (!solo || safe));
		if (!solo) assert.equal(project.tracks[1]!.solo, false, 'solo safe alone must not start a solo');
	});
}

test('desktop File Open imports and renders a solo-safe SESX track through real media grants', async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const wave = Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48000, float: true }));
	const hardware = await sesxDesktopHardwareFixture(sesxSoloSafeSession(true, true, false), wave);
	context.after(hardware.close);
	const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine,
		fileService: hardware.fileService, scapeProjectRuntime: createSoundscaperScapeNativeRuntime() });
	try {
		const choices = await hardware.fileService.chooseFiles({ purpose: 'project', multiple: false });
		await hardware.fileService.withReadDescriptors(choices, {}, async (files: readonly File[]) => {
			const opened = await controller.actions.project.openSesx(files[0]); assert.ok(opened);
		});
		const output = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }));
		const peak = output[0]!.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
		assert.ok(Math.abs(peak - .25) < .00001, `saved solo-safe programme peak ${String(peak)}`);
		assert.equal(hardware.releasedSessions.length, 1);
	} finally { await controller.dispose(); await native.dispose(); }
});
