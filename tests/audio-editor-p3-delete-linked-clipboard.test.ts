/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedClipboardFixture as fixture } from './helpers/linked-clipboard-project-fixture.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';


for (const linked of [false, true]) test(`Copy, Delete project, Paste preserves ${linked ? 'linked' : 'managed'} audio`, async (context) => {
	const { controller, store, project, pcm } = await fixture(context, linked);
	await controller.actions.project.remove();
	assert.notEqual(controller.project?.id, project.id);
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
	await controller.actions.edit.paste();
	const pasted = controller.project;
	assert.ok(pasted); assert.equal(pasted.clips.length, 1);
	const archive = await exportScapeProject(pasted, store);
	assert.ok(archive.blob instanceof Blob);
	const source = pasted.sources[0]; assert.ok(source);
	const session = await store.openSourceReadSession(source.storageKey);
	assert.ok(session);
	try { assert.deepEqual((await session.chunk(0)).channels, [pcm]); }
	finally { await session.release(); }
	assert.equal(await store.loadProject(project.id), null);
});

test('failed linked clipboard preservation leaves the original project and binding editable', async (context) => {
	const { controller, store, project, source } = await fixture(context, true);
	const originalBinding: unknown = await store.getLinkedOriginalBinding(project.id, source.id);
	const begin = store.beginSourceWrite.bind(store);
	store.beginSourceWrite = () => Promise.reject(new Error('Clipboard PCM storage failed'));
	await assert.rejects(controller.actions.project.remove(), /Clipboard PCM storage failed/u);
	assert.equal(controller.project?.id, project.id);
	assert.ok(await store.loadProject(project.id));
	assert.deepEqual(await store.getLinkedOriginalBinding(project.id, source.id), originalBinding);
	store.beginSourceWrite = begin;
	await controller.actions.project.rename('Still editable');
	assert.equal(controller.project?.title, 'Still editable');
	await controller.actions.project.remove();
	assert.notEqual(controller.project?.id, project.id);
});

test('a changed clipboard retires the staged copy before project deletion', async (context) => {
	const { controller, store, project, source, sessionController } = await fixture(context, true);
	const begin = store.beginSourceWrite.bind(store);
	let aborted = 0;
	store.beginSourceWrite = async (...args: Parameters<typeof begin>) => {
		const writer = await begin(...args);
		return { ...writer,
			async write(channels: unknown) { await writer.write(channels); sessionController.clearClipboard(); },
			async abort() { aborted += 1; await writer.abort(); },
		};
	};
	await assert.rejects(controller.actions.project.remove(), { name: 'AbortError' });
	assert.equal(aborted, 1);
	assert.equal(controller.project?.id, project.id);
	assert.ok(await store.getLinkedOriginalBinding(project.id, source.id));
	const metadata: unknown = await store.getSourceMetadata(source.storageKey);
	assert.ok(metadata && typeof metadata === 'object' && 'storage' in metadata);
	assert.equal(metadata.storage, 'linked-audio-original-v1');
	await controller.actions.project.rename('Still editable after cancellation');
	assert.equal(controller.project?.title, 'Still editable after cancellation');
});

test('failed preservation and writer cleanup retain both causes without deleting the project', async context => {
	const { controller, store, project, source } = await fixture(context, true);
	const begin = store.beginSourceWrite.bind(store);
	const failure = new Error('Clipboard write failed'), cleanup = new Error('Clipboard abort failed');
	store.beginSourceWrite = async (...args: Parameters<typeof begin>) => {
		const writer = await begin(...args);
		return { ...writer, async write() { throw failure; }, async abort() { await writer.abort(); throw cleanup; } };
	};
	await assert.rejects(controller.actions.project.remove(), error => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [failure, cleanup]);
		assert.equal(error.cause, cleanup);
		return true;
	});
	assert.equal(controller.project?.id, project.id);
	assert.ok(await store.loadProject(project.id));
	assert.ok(await store.getLinkedOriginalBinding(project.id, source.id));
});

test('deleting a project without copied media does not read its linked original', async (context) => {
	const { controller, store, project, sessionController } = await fixture(context, true);
	sessionController.clearClipboard();
	store.openSourceReadSession = () => { throw new Error('Unexpected clipboard materialization'); };
	await controller.actions.project.remove();
	assert.notEqual(controller.project?.id, project.id);
});

test('linked clipboard preservation keeps every bounded packet and the short final packet exact', async context => {
	const { controller, store, source, pcm } = await fixture(context, true, 140_003);
	const begin = store.beginSourceWrite.bind(store);
	const packetFrames: number[] = [];
	store.beginSourceWrite = async (...args: Parameters<typeof begin>) => {
		const writer = await begin(...args);
		return { ...writer, async write(channels: unknown) {
			assert.ok(Array.isArray(channels) && channels[0] instanceof Float32Array);
			packetFrames.push(channels[0].length);
			assert.ok(channels[0].length <= 65_536);
			await writer.write(channels);
		} };
	};
	await controller.actions.project.remove();
	assert.equal(packetFrames.reduce((sum, frames) => sum + frames, 0), pcm.length);
	assert.ok(packetFrames.length > 1);
	assert.ok(packetFrames.at(-1)! < packetFrames[0]!);
	const restored = new Float32Array(pcm.length);
	let offset = 0;
	for await (const chunk of store.readSourceChunks(source.storageKey)) {
		restored.set(chunk.channels[0], offset); offset += chunk.frames;
	}
	assert.deepEqual(restored, pcm);
});
