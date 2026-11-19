/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { deferred } from './helpers/async-test-control.ts';
import { writeProjectPcm } from './helpers/native-render-custody.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { readWavePcm } from './helpers/read-wave-pcm.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

for (const returnToOrigin of [false, true]) test(returnToOrigin
	? 'a prepared WAV cannot use a retired activation of the same reopened project'
	: 'a prepared WAV cannot deliver another reopened project', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-export-ownership-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const first = await writeArchive(directory, 'original-interview', 12_000, .25);
	const second = await writeArchive(directory, 'other-interview', 18_000, .5);
	const native = createNodeWebAudioEngineFactory(context);
	const createBarrier = () => ({ entered: deferred<void>(), release: deferred<void>() });
	let barrier: ReturnType<typeof createBarrier> | null = null;
	const { controller } = await controllerSession(context, {
		engine: native.createEngine(),
		engineFactory: native.createEngine,
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		prepareProjectForExport: async (purpose: string) => {
			assert.equal(purpose, 'audio-export');
			const capture = barrier;
			if (!capture) return;
			capture.entered.resolve();
			await capture.release.promise;
		},
	});
	const startExport = async () => {
		const project = controller.getSnapshot().project;
		const settings = createExportDialogInitialSettings(project);
		return await controller.actions.export.start(createExportDialogRequest(settings, { project }));
	};
	try {
		await controller.actions.project.openScapeFile(second, () => 'copy');
		assert.equal(controller.project?.id, 'other-interview');
		await controller.actions.project.openScapeFile(first, () => 'copy');
		assert.equal(controller.project?.id, 'original-interview');

		const capture = createBarrier();
		barrier = capture;
		const pending = Promise.allSettled([startExport()]);
		try {
			await Promise.race([capture.entered.promise, pending.then(() => assert.fail('Export never reached live-state preparation.'))]);
			await controller.actions.project.openById('other-interview');
			assert.equal(controller.project?.id, 'other-interview');
			if (returnToOrigin) await controller.actions.project.openById('original-interview');
		} finally {
			barrier = null;
			capture.release.resolve();
		}
		const [retired] = await pending;
		assert.ok(retired?.status === 'fulfilled');
		if (retired.value) {
			const wave = await decodeDeliveredWave(retired.value);
			assert.fail(`Retired export delivered ${wave.channels[0]?.length} frames at level ${wave.channels[0]?.[2000]}.`);
		}
		assert.equal(native.snapshot().offlineContexts, 0);
		assert.equal(controller.getSnapshot().export.output, null);
		const wave = await decodeDeliveredWave(await startExport());
		assert.equal(wave.sampleRate, 48_000);
		assert.deepEqual(wave.channels.map(channel => channel.length), returnToOrigin ? [12_000, 12_000] : [18_000, 18_000]);
		const expected = returnToOrigin ? .25 : .5;
		for (const channel of wave.channels) assert.ok(channel.slice(1000, -1000).every(sample => Math.abs(sample - expected) < 0.000001));
	} finally { await controller.dispose(); await native.dispose(); }
});

async function decodeDeliveredWave(output: unknown) {
	assert.ok(output && typeof output === 'object' && 'url' in output && typeof output.url === 'string');
	const response = await fetch(output.url);
	assert.equal(response.ok, true);
	return readWavePcm(new Uint8Array(await response.arrayBuffer()));
}

async function writeArchive(directory: string, name: string, frames: number, level: number): Promise<File> {
	const wavPath = join(directory, `${name}.wav`);
	const channel = new Float32Array(frames).fill(level);
	await writeFile(wavPath, encodeWav([channel, channel], { sampleRate: 48_000, float: true }));
	const wav = readWavePcm(new Uint8Array(await (await openAsBlob(wavPath)).arrayBuffer()));
	const source = createAudioSource({ id: `${name}-source`, name: `${name}.wav`, sampleRate: 48_000, channelCount: 2, frameCount: frames });
	const clip = createAudioClip({ id: `${name}-clip`, sourceId: source.id, durationFrames: frames });
	const project = createSoundscaperProject({ id: name, title: name, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: `${name}-track`, clipIds: [clip.id] })] });
	const store = createSoundscaperEphemeralProjectStore();
	try {
		await writeProjectPcm(store, project, new Map([[source.id, wav.channels]]));
		const { blob } = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store);
		assert.ok(blob);
		const archivePath = join(directory, `${name}.sscape`);
		await writeFile(archivePath, new Uint8Array(await blob.arrayBuffer()));
		return new File([await openAsBlob(archivePath)], `${name}.sscape`);
	} finally { await store.close(); }
}
