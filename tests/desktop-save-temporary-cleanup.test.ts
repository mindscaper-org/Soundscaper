/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';

const TEST_OWNER = Object.freeze({ name: 'renderer-test-owner' });

function createManager(options: Readonly<Record<string, unknown>>): AtomicSaveManager {
	return new AtomicSaveManager(options as unknown as ConstructorParameters<typeof AtomicSaveManager>[0]);
}

for (const outcome of ['finish', 'abort', 'revoke'] as const) {
	test(`Linux ${outcome} retires only the owned stage after moving the destination folder`,
		{ skip: process.platform !== 'linux' }, async context => {
			const root = await mkdtemp(join(tmpdir(), 'scape-save-stage-folder-move-'));
			const selected = join(root, 'selected');
			const moved = join(root, 'moved');
			const targets = new SaveTargetStore();
			const manager = createManager({ targets });
			context.after(async () => {
				try { await manager.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
			});
			await mkdir(selected);
			const name = 'project.sscape';
			const targetPath = join(selected, name);
			await writeFile(targetPath, 'previous archive');
			const target = targets.registerPath(targetPath, { owner: TEST_OWNER, purpose: 'project-copy' });
			const { writeId } = await manager.begin({ owner: TEST_OWNER, targetId: target.id, size: 3 });
			await manager.writeChunk({ owner: TEST_OWNER, writeId, offset: 0, bytes: Uint8Array.of(1, 2, 3) });
			const stageName = `.${writeId}.soundscaper-part`;
			const owned = await lstat(join(selected, stageName), { bigint: true });
			await rename(selected, moved);
			await mkdir(selected);
			await writeFile(targetPath, 'independent archive');
			const otherPath = join(selected, stageName);
			await writeFile(otherPath, 'independent stage pathname');
			const independent = await lstat(otherPath, { bigint: true });
			assert.notEqual(owned.ino, independent.ino);

			if (outcome === 'finish') await assert.rejects(manager.finish(writeId, { owner: TEST_OWNER }), /commit the saved file/iu);
			if (outcome === 'abort') assert.equal(await manager.abort(writeId, { owner: TEST_OWNER }), true);
			if (outcome === 'revoke') await manager.revokeOwner(TEST_OWNER);
			assert.equal((await lstat(otherPath, { bigint: true })).ino, independent.ino);
			assert.equal(await readFile(otherPath, 'utf8'), 'independent stage pathname');
			assert.equal(await readFile(targetPath, 'utf8'), 'independent archive');
			assert.equal(await readFile(join(moved, name), 'utf8'), 'previous archive');
			assert.deepEqual(await readdir(moved), [name]);
		});
}

test('a failed post-publication refresh preserves the saved file and a reused staging name', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-save-stage-published-'));
	const targets = new SaveTargetStore();
	const manager = createManager({ targets });
	context.after(async () => {
		try { await manager.dispose(); } finally { await rm(root, { recursive: true, force: true }); }
	});
	const destination = join(root, 'project.sscape');
	const target = targets.registerPath(destination, { owner: TEST_OWNER, purpose: 'project',
		afterCommit: async () => {
			await writeFile(stagePath, 'new independent staging file', { flag: 'wx' });
			throw new Error('Could not refresh the saved-file association');
		},
	});
	const { writeId } = await manager.begin({ owner: TEST_OWNER, targetId: target.id, size: 3 });
	const stagePath = join(root, `.${writeId}.soundscaper-part`);
	await manager.writeChunk({ owner: TEST_OWNER, writeId, offset: 0, bytes: Uint8Array.of(10, 20, 30) });
	await assert.rejects(manager.finish(writeId, { owner: TEST_OWNER }), /commit the saved file/iu);
	assert.deepEqual(await readFile(destination), Buffer.from([10, 20, 30]));
	assert.equal(await readFile(stagePath, 'utf8'), 'new independent staging file');
});

test('save-session disposal drains a rejected write and aborts every remaining stage', async () => {
	const writeStarted = deferred();
	const writeGate = deferred();
	const events: string[] = [];
	let handleId = 0;
	const openedPaths: string[] = [];
	const targets = new SaveTargetStore();
	const manager = createManager({
		targets,
		openImpl: async (path: string) => {
			openedPaths.push(path);
			const id = handleId++;
			return {
				async write() {
					events.push(`write-${id}`);
					writeStarted.resolve();
					await writeGate.promise;
					throw new Error('injected write failure');
				},
				async close() { events.push(`close-${id}`); },
			};
		},
		unlinkImpl: async (path: string) => { events.push(`unlink-${openedPaths.indexOf(path)}`); },
	});
	const firstTarget = targets.registerPath('/tmp/first.scape', { owner: TEST_OWNER, purpose: 'project' });
	const secondTarget = targets.registerPath('/tmp/second.scape', { owner: TEST_OWNER, purpose: 'project' });
	const first = await manager.begin({ owner: TEST_OWNER, targetId: firstTarget.id, maximumSize: 1 });
	await manager.begin({ owner: TEST_OWNER, targetId: secondTarget.id, maximumSize: 1 });
	const writing = manager.writeChunk({ owner: TEST_OWNER, writeId: first.writeId, offset: 0, bytes: Uint8Array.of(1) });
	await writeStarted.promise;

	let disposalSettled = false;
	const disposing = Promise.resolve(manager.dispose());
	void disposing.then(() => { disposalSettled = true; });
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(disposalSettled, false, 'shutdown waits for the failing admitted write');
	writeGate.resolve();
	await assert.rejects(writing, /injected write failure/u);
	await disposing;

	assert.deepEqual(events.slice(0, 1), ['write-0']);
	assert.deepEqual(new Set(events.slice(1)), new Set(['close-0', 'close-1', 'unlink-0', 'unlink-1']));
});

test('save-session disposal reports every unacknowledged close and unlink', async () => {
	let handleId = 0;
	let unlinkFailurePath: string | undefined;
	const targets = new SaveTargetStore();
	const manager = createManager({
		targets,
		openImpl: async (path: string) => {
			const id = handleId++;
			if (id === 1) unlinkFailurePath = path;
			return {
				async close() {
					if (id === 0) throw new Error('injected close failure');
				},
			};
		},
		unlinkImpl: async (path: string) => {
			if (path === unlinkFailurePath) throw new Error('injected unlink failure');
		},
	});
	let target = targets.registerPath('/tmp/close-failure.scape', { owner: TEST_OWNER, purpose: 'project' });
	await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	target = targets.registerPath('/tmp/unlink-failure.scape', { owner: TEST_OWNER, purpose: 'project' });
	await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });

	await assert.rejects(Promise.resolve(manager.dispose()), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /save staging cleanup failed/u);
		assert.deepEqual(
			new Set(error.errors.map((failure: unknown) => failure instanceof Error ? failure.message : String(failure))),
			new Set(['Could not close the temporary save file', 'Could not remove the temporary save file']),
		);
		return true;
	});
	assert.throws(
		() => targets.registerPath('/tmp/after-cleanup-failure.scape', { owner: TEST_OWNER, purpose: 'project' }),
		/disposed/u,
	);
});

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}
