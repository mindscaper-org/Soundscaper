/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAiff } from '../src/common/editor/aiff.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { maintainedAiffMimeType } from '../src/common/editor/controller/import/internal/aiff-file-identity.ts';
import { WORKSPACE_IMPORT_FILE_ACCEPT } from '../src/common/editor/ui/workspace/workspace-file-routing.js';

for (const [name, type] of [['Recording', 'audio/aiff'], ['Recording.original', 'audio/x-aiff'], ['Recording.aiff', 'audio/aiff']] as const) {
	test(`File Import reads ${name} (${type}) through the maintained AIFF reader`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en', store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const pcm = [new Float32Array(4_800).fill(.25), new Float32Array(4_800).fill(-.125)];
		const encoded = encodeAiff(pcm, { sampleRate: 48_000, bitDepth: 16, dither: false });
		assert.ok(encoded instanceof Uint8Array);
		const bytes = Uint8Array.from(encoded);
		await controller.actions.project.importFiles([new File([bytes.buffer], name, { type })]);
		const project = controller.project; assert.ok(project);
		assert.equal(project.sources.length, 1, JSON.stringify(controller.getSnapshot().status));
		const source = project.sources[0]; assert.ok(source);
		assert.equal(source.sampleRate, 48_000); assert.equal(source.frameCount, 4_800); assert.equal(source.channelCount, 2);
		assert.equal(source.mimeType, 'audio/aiff');
		const chunk = await store.readSourceChunk(source.storageKey ?? source.id, 0);
		assert.deepEqual(chunk.channels.map(channel => channel[2_400]), [.25, -.125]);
	});
}

test('AIFF MIME fallback keeps explicit alternative format suffixes and generic MIME refusals', () => {
	for (const suffix of WORKSPACE_IMPORT_FILE_ACCEPT.split(',').filter(token => token.startsWith('.'))) {
		if (/^\.aif[fc]?$/u.test(suffix)) continue;
		assert.equal(maintainedAiffMimeType({ name: `Recording${suffix}`, type: 'audio/aiff' }), null, suffix);
	}
	for (const type of ['', 'application/octet-stream', undefined]) {
		assert.equal(maintainedAiffMimeType({ name: 'Recording.original', type }), null);
	}
});
