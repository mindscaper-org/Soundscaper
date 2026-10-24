/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperDesktopMcpPort } from '../src/common/editor/desktop-mcp-port.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { deferred } from './helpers/async-test-control.ts';

test('desktop MCP retains imported literal TXXX credits', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en',
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const payload = Buffer.from('\x03$soundscaperOpaqueBinary\0Reviewed recording credit');
	const frame = Buffer.alloc(10); frame.write('TXXX'); frame[7] = payload.length;
	const id3 = Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 10 + payload.length]), frame, payload]);
	const chunk = Buffer.alloc(8 + id3.length + id3.length % 2); chunk.write('id3 '); chunk.writeUInt32LE(id3.length, 4); id3.copy(chunk, 8);
	const wav = Buffer.concat([Uint8Array.from(encodeWav([new Float32Array(480).fill(.25)], { sampleRate: 48_000, float: true })), chunk]);
	wav.writeUInt32LE(wav.length - 8, 4);
	await controller.actions.project.importFiles([new File([wav], 'Recording.wav', { type: 'audio/wav' })]);
	const project = controller.getSnapshot().project; assert.ok(project);
	type Request = { requestId: string; operation: string; args: unknown };
	let listener: ((request: Request) => void) | undefined;
	const reply = deferred<{ success: boolean; result?: unknown; error?: string }>();
	const port = createSoundscaperDesktopMcpPort({ controller, fileService: {
		onMcpRequest(next) { listener = next; return () => { listener = undefined; }; },
		respondMcpRequest(response) { reply.resolve(response); },
	} });
	try {
		assert.ok(listener);
		listener({ requestId: 'literal-credit', operation: 'read_project_document',
			args: { projectId: project.id, expectedRevision: project.revision } });
		const response = await reply.promise; assert.equal(response.success, true);
		const page = response.result as { content: string; nextCursor: string | null };
		assert.equal(page.nextCursor, null);
		const document = JSON.parse(page.content) as { sources: { provenance: { contributions: { metadata: { raw: { TXXX?: Record<string, string> } } }[] } }[] };
		assert.deepEqual(document.sources[0]?.provenance.contributions[0]?.metadata.raw.TXXX,
			{ $soundscaperOpaqueBinary: 'Reviewed recording credit' });
	} finally { port.dispose(); }
});

test('desktop MCP permits literal text tags without exposing binary wrappers elsewhere', async () => {
	const marker = '$soundscaperOpaqueBinary';
	const project = { id: 'privacy', title: 'Privacy', revision: 0, metadata: {
		tags: { [marker]: 'Literal project credit' },
		nested: { [marker]: 'Encoded binary outside text tags', bytes: 'private bytes' },
		raw: { TXXX: { [marker]: true, bytes: 'private bytes' } },
		buffer: new Uint8Array([1, 2]),
	}, opaqueExtensions: { private: 'private bytes' } };
	type Request = { requestId: string; operation: string; args: unknown };
	let listener: ((request: Request) => void) | undefined;
	const reply = deferred<{ success: boolean; result?: unknown }>();
	const port = createSoundscaperDesktopMcpPort({ controller: {
		getSnapshot: () => ({ project, readOnly: false, selectedTrackId: null, selectedClipId: null, selectedAnnotationId: null }),
		actions: { edit: { commit() { assert.fail('read must not edit'); } } },
	}, fileService: {
		onMcpRequest(next) { listener = next; return () => { listener = undefined; }; },
		respondMcpRequest(response) { reply.resolve(response); },
	} });
	try {
		assert.ok(listener);
		listener({ requestId: 'privacy', operation: 'read_project_document', args: { projectId: project.id, expectedRevision: 0 } });
		const response = await reply.promise; assert.equal(response.success, true);
		const page = response.result as { content: string; nextCursor: string | null };
		assert.deepEqual(JSON.parse(page.content), { id: 'privacy', title: 'Privacy', revision: 0,
			metadata: { tags: { [marker]: 'Literal project credit' }, raw: {} } });
	} finally { port.dispose(); }
});
