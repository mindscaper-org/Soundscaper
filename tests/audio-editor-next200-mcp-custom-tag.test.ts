/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperDesktopMcpPort } from '../src/common/editor/desktop-mcp-port.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { deferred } from './helpers/async-test-control.ts';

test('desktop MCP retains an authored __proto__ custom metadata credit as inert own data', async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en',
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'next200-mcp-custom-tag' }),
		engine: createMemoryEngine() as unknown as Options['engine'] });
	await controller.ready;
	const credit = 'Microphone body, contact channel';
	controller.actions.metadata.update({ tags: { ['__proto__']: credit, recorder: 'Field recorder' } });
	const project = controller.getSnapshot().project;
	assert.ok(project);
	const metadata = project.metadata as Readonly<Record<string, unknown>>;
	const tags = metadata.tags as Readonly<Record<string, unknown>>;
	assert.equal(Object.hasOwn(tags, '__proto__'), true, 'the same tag name admitted by the ID3 custom-field UI is stored');
	assert.equal(tags['__proto__'], credit);
	type Request = { requestId: string; operation: string; args: unknown };
	let listener: ((request: Request) => void) | undefined;
	const reply = deferred<{ success: boolean; result?: unknown; error?: string }>();
	const port = createSoundscaperDesktopMcpPort({ controller, fileService: {
		onMcpRequest(next) { listener = next; return () => { listener = undefined; }; },
		respondMcpRequest(response) { reply.resolve(response); },
	} });
	try {
		assert.ok(listener);
		listener({ requestId: 'custom-credit', operation: 'read_project_document',
			args: { projectId: project.id, expectedRevision: project.revision } });
		const response = await reply.promise;
		assert.equal(response.success, true, response.error ?? 'The metadata read must succeed.');
		const page = response.result as { content: string; nextCursor: string | null };
		assert.equal(page.nextCursor, null);
		const delivered = JSON.parse(page.content) as { metadata: { tags: Record<string, unknown> } };
		assert.equal(Object.hasOwn(delivered.metadata.tags, '__proto__'), true);
		assert.equal(delivered.metadata.tags['__proto__'], credit);
		assert.equal(delivered.metadata.tags.recorder, 'Field recorder');
		assert.equal(Object.getPrototypeOf(delivered.metadata.tags), Object.prototype);
		assert.equal(Object.hasOwn(Object.prototype, 'recorder'), false);
	} finally { port.dispose(); await controller.dispose(); }
});
