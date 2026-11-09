/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createMemoryEngine, type createAudioEditorController } from './helpers/audio-editor-controller-harness.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { assertEditedAudioArchiveCustody } from './helpers/edited-audio-archive-custody.ts';
import { editedM4aFixture } from './helpers/ordinary-tail-m4a-fixture.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';
import { createFreesoundApiClient } from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { createFreesoundPanelSession } from '../src/common/editor/ui/workspace/freesound-panel-session.ts';

for (const mode of ['multiple', 'rate', 'all-empty'] as const) {
	test(`File Import refuses ${mode} edits before decoding and recovers into actual PCM custody`, async context => {
		const stats = forbidNativeAllocation(context);
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const { controller, store } = await controllerSession(context, { engine: {
			...createMemoryEngine(), decodeAudioData: async () => { stats.decoders++; assert.fail('Invalid edit lists must be refused before decoding'); },
		} as unknown as Options['engine'] });
		const original: unknown = structuredClone(controller.project);
		const { file } = await editedM4aFixture(mode);
		await controller.actions.project.importFiles([file]);
		assert.deepEqual(controller.project, original);
		assert.equal(controller.getSnapshot().importing, false); assert.equal(controller.getSnapshot().history.canUndo, false);
		assert.equal(controller.getSnapshot().status.state, 'error');
		assert.match(controller.getSnapshot().status.message, /edit.*(?:flatten|render)/iu);
		assert.deepEqual(stats, { contexts: 0, decoders: 0 });
		const healthy = flattened();
		await controller.actions.project.importFiles([healthy.file]); await controller.actions.project.flush();
		const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
		assert.equal(project.sources.length, 1); assert.equal(project.clips.length, 1);
		assert.equal(project.sources[0]?.frameCount, 128); assert.equal(project.sources[0]?.sampleRate, 48_000);
		await assertEditedAudioArchiveCustody(context, store, project, [healthy.pcm]);
		assert.deepEqual(stats, { contexts: 0, decoders: 0 });
	});

	test(`Freesound refuses ${mode} edits in its real queue without HTTP audio and recovers for WAV`, async context => {
		const stats = forbidNativeAllocation(context), posted: Uint8Array[] = [];
		const client = createFreesoundApiClient({ openAuthorization() {}, request: async (path, init) => {
			if (path.endsWith('/oauth/session')) return Response.json({ data: { connected: true, user: { username: 'recorder' } } });
			if (path.endsWith('/uploads/pending')) return Response.json({ data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } });
			assert.ok(path.endsWith('/uploads')); assert.ok(init?.body instanceof File);
			posted.push(new Uint8Array(await init.body.arrayBuffer())); return Response.json({ data: { uploadFilename: 'flattened.wav' } });
		} });
		const session = createFreesoundPanelSession(client, { prepareFile: prepareFreesoundUploadFile });
		await session.initialize();
		const { file } = await editedM4aFixture(mode); session.enqueueFiles([file]); await idle();
		const failed = session.getSnapshot().uploadQueue.items[0]; assert.ok(failed);
		assert.equal(failed.status, 'failed'); assert.equal(failed.uploadFailure?.reason, 'preparationFailed');
		assert.match(failed.errorMessage ?? '', /edit.*(?:flatten|render)/iu);
		assert.deepEqual(posted, []); assert.deepEqual(stats, { contexts: 0, decoders: 0 });
		const healthy = flattened(); session.enqueueFiles([healthy.file]); await idle();
		assert.deepEqual(session.getSnapshot().uploadQueue.items.map(item => item.status), ['failed', 'ready-to-publish']);
		assert.equal(posted.length, 1); assert.deepEqual(posted[0], new Uint8Array(await healthy.file.arrayBuffer()));
		assert.deepEqual(stats, { contexts: 0, decoders: 0 });
		async function idle() {
			for (let attempt = 0; session.getSnapshot().uploadQueue.active; attempt++) { assert.ok(attempt < 1000); await setImmediate(); }
		}
	});
}

function flattened() {
	const pcm = Float32Array.from({ length: 128 }, (_, frame) => (frame % 13 - 6) / 8);
	return { pcm, file: new File([Uint8Array.from(encodeWav([pcm], { sampleRate: 48_000, float: true, dither: false }))], 'Flattened.wav', { type: 'audio/wav' }) };
}

/** A capability declaration admits preflight, but every attempted native allocation fails. */
function forbidNativeAllocation(context: TestContext) {
	const stats = { contexts: 0, decoders: 0 };
	for (const [name, implementation] of Object.entries({
		AudioDecoder: class {
			constructor() { stats.decoders++; assert.fail('Unsupported edit lists must not allocate native decoders'); }
			static isConfigSupported(config: AudioDecoderConfig) { return Promise.resolve({ supported: true, config }); }
		},
		AudioContext: class { constructor() { stats.contexts++; assert.fail('Unsupported edit lists must not allocate decode contexts'); } },
	})) {
		const previous = Object.getOwnPropertyDescriptor(globalThis, name);
		Object.defineProperty(globalThis, name, { configurable: true, value: implementation });
		context.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
	}
	return stats;
}
