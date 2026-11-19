/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { pcmSourceClockCases } from './helpers/pcm-source-clock-cases.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

for (const fixture of pcmSourceClockCases()) test(`PCM ${fixture.id} retains source clock, native output and independent Scape reopening`, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const archive = createSoundscaperScapeNativeRuntime();
	const { controller, store } = await controllerSession(context, { engine, engineFactory: native.createEngine, scapeProjectRuntime: archive });
	const recipient = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:recipient` });
	try {
		await controller.actions.project.importFiles([fixture.file]);
		const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
		await verify(project, store);
		await controller.actions.project.flush();
		const saved = await archive.exportScapeProject(project, store); assert.ok(saved.blob);
		const imported = await archive.importScapeProject(saved.blob, recipient); assert.equal(imported.readOnly, false);
		const reopened: unknown = imported.project; assert.ok(validateSoundscaperProject(reopened));
		assert.deepEqual(reopened, project);
		await verify(reopened, recipient);
	} finally { await controller.dispose(); await recipient.close(); await native.dispose(); }

	async function verify(project: SoundscaperProject, repository: AudioEditorProjectStore): Promise<void> {
		assert.equal(project.sampleRate, 48_000);
		assert.equal(project.sources.length, 1); assert.equal(project.clips.length, 1);
		const source = project.sources[0]; assert.ok(source?.kind === 'audio');
		assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [fixture.sampleRate, fixture.frameCount, fixture.channelCount]);
		assertPcmChannelsEqual(await readCustodyPcm(repository, source), fixture.channels, 'original imported PCM');
		const frames = fixture.frameCount * 48_000 / fixture.sampleRate;
		assert.equal(project.clips[0]?.durationFrames, frames);
		const renderer = native.createEngine();
		try {
			const buffer = await repository.loadSourceAudioBuffer(source.storageKey, await renderer.getAudioContext({ resume: false }));
			assert.ok(buffer instanceof AudioBuffer); assert.equal(buffer.sampleRate, fixture.sampleRate);
			renderer.loadProject(projectForRuntimeConsumers(project), new Map([[source.id, buffer]]));
			const output = await renderer.renderMix({ startFrame: 0, endFrame: frames });
			assert.ok(output instanceof AudioBuffer);
			assert.deepEqual([output.sampleRate, output.length, output.numberOfChannels], [48_000, frames, 2]);
			for (let channel = 0; channel < 2; channel++) {
				const expected = fixture.channelCount === 1 ? .125 * Math.SQRT1_2 : channel ? -.0625 : .125;
				for (let frame = 256; frame < frames - 256; frame++) assert.ok(Math.abs(output.getChannelData(channel)[frame]! - expected) < 1e-6,
					`independent DC programme at channel ${channel}, frame ${frame}: expected ${expected}`);
			}
		} finally { await renderer.dispose(); }
	}
});
