/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { linkedClipboardFixture } from './helpers/linked-clipboard-project-fixture.ts';

test('actual Delete Project captures its copied linked audio once while preserving exact PCM chunks', async context => {
	const { controller, store, source, pcm } = await linkedClipboardFixture(context, true, 65_536 * 32 + 3, 200);
	const stringify = JSON.stringify, clone = globalThis.structuredClone;
	let serializations = 0, copies = 0;
	JSON.stringify = function(value: unknown, ...rest: unknown[]): string | undefined {
		if (isClipboard(value)) serializations++;
		return Reflect.apply(stringify, JSON, [value, ...rest]) as string | undefined;
	} as typeof JSON.stringify;
	globalThis.structuredClone = function<T>(value: T, options?: StructuredSerializeOptions): T {
		if (isClipboard(value)) copies++;
		return clone(value, options);
	};
	try {
		await controller.actions.project.remove();
		assert.equal(serializations, 0, `${serializations} complete clipboard serializations`);
		assert.ok(copies <= 6, `${copies} complete clipboard copies`);
	} finally { JSON.stringify = stringify; globalThis.structuredClone = clone; }
	const restored = new Float32Array(pcm.length);
	let frames = 0;
	for await (const chunk of store.readSourceChunks(source.storageKey)) {
		restored.set(chunk.channels[0], frames); frames += chunk.frames;
	}
	assert.equal(frames, pcm.length);
	assert.deepEqual(restored, pcm);
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
});

function isClipboard(value: unknown): boolean {
	return Boolean(value && typeof value === 'object' && 'originProjectId' in value && value.originProjectId === 'origin' && 'descriptor' in value);
}


test('the opaque session clipboard fence retires on replacement, restoration, clear and disposal', async context => {
	const { sessionController: session, project } = await linkedClipboardFixture(context, true);
	const captured = session.getClipboardGeneration();
	const clipboard = session.clipboardForProject(project.id);
	assert.ok(clipboard);
	Reflect.set(clipboard, 'originProjectId', 'caller-owned-copy');
	assert.equal(session.getClipboardGeneration(), captured);
	const retained = session.clipboardForProject(project.id)!;
	session.setClipboard(retained);
	const replaced = session.getClipboardGeneration();
	assert.notEqual(replaced, captured, 'even identical replacements must retire in-flight ownership');
	const restored = createAudioEditorSessionController({ snapshot: session.serialize(), currentSchemaVersion: project.schemaVersion });
	assert.notEqual(restored.getClipboardGeneration(), replaced);
	assert.deepEqual(restored.clipboardForProject(project.id), retained);
	const restoredToken = restored.getClipboardGeneration();
	restored.dispose();
	assert.notEqual(restored.getClipboardGeneration(), restoredToken);
	session.clearClipboard();
	const cleared = session.getClipboardGeneration();
	assert.notEqual(cleared, replaced);
	session.setClipboard(retained);
	assert.notEqual(session.getClipboardGeneration(), cleared);
});
