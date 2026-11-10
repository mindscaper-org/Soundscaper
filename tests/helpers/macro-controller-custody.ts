/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { controllerSession } from './soundscaper-controller-session.ts';
import { registerMockModuleUrls } from './mock-module-urls.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { readPcm } from './project-store-pcm-fixture.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';

/** A real script host/transaction/controller/store; only worker transport and playback are ports. */
export async function macroControllerCustody(context: TestContext, frameCount = 38_400) {
	const hooks = registerMockModuleUrls({ '../../macro-script/browser-sandbox.ts': new URL('./macro-vm-worker-transport.ts', import.meta.url).href });
	context.after(() => { hooks.deregister(); });
	const { controller, store } = await controllerSession(context, {
		engineFactory: () => { throw new Error('Controller programs must not use a synthetic DSP renderer.'); },
	});
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, channelCount: 1, frameCount });
	const pcm = [Float32Array.from({ length: frameCount }, (_, frame) => frame % 2 === 0 ? .25 : -.125)];
	const writer = await store.beginSourceWrite(source.storageKey, source);
	for (let frame = 0; frame < frameCount; frame += 65_536) await writer.write(pcm.map(channel => channel.subarray(frame, frame + 65_536)));
	await writer.commit();
	const project = createSoundscaperProject({ id: 'macro-custody', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice.wav', durationFrames: frameCount, sourceDurationFrames: frameCount })] });
	await store.saveProject(project); await controller.actions.project.open(project);
	await controller.actions.timeline.selectClip('clip');
	return { controller, store, project, assertArchiveCustody };

	async function assertArchiveCustody() {
		const current = controller.project; assert.ok(validateSoundscaperProject(current));
		const archive = createSoundscaperScapeNativeRuntime();
		const exported = await archive.exportScapeProject(current, store); assert.ok(exported.blob);
		const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		context.after(async () => { await recipient.close(); });
		const reopened = await archive.importScapeProject(exported.blob, recipient);
		assert.equal(reopened.readOnly, false); assert.ok(validateSoundscaperProject(reopened.project));
		assert.equal(reopened.project.sources.length, 1);
		const restored = reopened.project.sources[0]; assert.ok(restored?.kind === 'audio');
		assert.deepEqual([restored.frameCount, restored.channelCount, restored.sampleRate], [frameCount, 1, 48_000]);
		assertPcmChannelsEqual((await readPcm(recipient, restored.storageKey)).map(channel => Float32Array.from(channel)), pcm);
		return reopened.project;
	}
}
