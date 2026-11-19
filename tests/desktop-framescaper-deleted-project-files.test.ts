/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import fileSystem, { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { createFramescaperDesktopProjectLibraryPaths } from '../desktop/framescaper-project-library-contract.ts';
import { framescaperDesktopExactMediaPath } from '../desktop/project-library-exact-generation-storage.ts';
import { validateFramescaperDesktopBodyDescriptor } from '../src/framescaper/desktop-project-library-body-contract.ts';
import { deferred } from './helpers/async-test-control.ts';
import { startFramescaperDesktopProjectSession } from './helpers/framescaper-desktop-project-session.ts';
import { framescaperPortableTimelineImage, openFramescaperImageFixtureLibrary, saveFramescaperImageFixtureArchive } from './helpers/framescaper-portable-timeline-image.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('desktop Delete project removes its document and last managed image reference while preserving the saved archive', async context => {
	const { directory, fixture, input } = await authoredArchive(context);
	const original = await input.arrayBuffer();
	const paths = createFramescaperDesktopProjectLibraryPaths(directory);
	const desktop = await startFramescaperDesktopProjectSession(directory);
	try {
		const { controller } = desktop;
		await controller.actions.project.openScapeFile(input, () => assert.fail('Expected a fresh working copy.'));
		const first = readManagedFiles(paths, fixture.project.id);
		assert.deepEqual(Uint8Array.from(await readFile(first.body)), fixture.bytes);
		const control = join(dirname(first.body), 'unrelated.bin');
		await writeFile(control, 'Leave unrelated bytes in place.');
		await controller.actions.project.duplicate(undefined);
		const copyId = controller.project?.id;
		assert.ok(copyId && copyId !== fixture.project.id);
		const copy = readManagedFiles(paths, copyId);
		assert.equal(copy.body, first.body);
		assert.notEqual(copy.document, first.document);
		await removeOpenProject(desktop, fixture.project.id);
		assert.equal(projectExists(paths.databasePath, fixture.project.id), false);
		await assert.rejects(stat(first.document), { code: 'ENOENT' });
		assert.deepEqual(Uint8Array.from(await readFile(copy.body)), fixture.bytes);
		assert.equal(projectExists(paths.databasePath, copyId), true);
		await removeOpenProject(desktop, copyId);
		assert.equal(projectExists(paths.databasePath, copyId), false);
		await assert.rejects(stat(copy.document), { code: 'ENOENT' });
		await assert.rejects(stat(first.body), { code: 'ENOENT' });
		assert.equal(await readFile(control, 'utf8'), 'Leave unrelated bytes in place.');
	} finally { await desktop.close(); }
	assert.deepEqual(await input.arrayBuffer(), original);
	const restarted = await startFramescaperDesktopProjectSession(directory);
	try {
		await restarted.controller.actions.project.openScapeFile(input, () => assert.fail('No working copy should remain.'));
		assert.deepEqual(Uint8Array.from(await readFile(readManagedFiles(paths, fixture.project.id).body)), fixture.bytes);
	} finally { await restarted.close(); }
});

test('a committed desktop deletion retries its exact file when a blocked directory is writable after restart', {
	skip: typeof process.getuid !== 'function' || process.getuid() === 0,
}, async context => {
	const { directory, fixture, input } = await authoredArchive(context);
	const paths = createFramescaperDesktopProjectLibraryPaths(directory);
	let bodyPath: string;
	let blockedDirectory: string | null = null;
	try {
		const desktop = await startFramescaperDesktopProjectSession(directory);
		try {
			await desktop.controller.actions.project.openScapeFile(input, () => assert.fail('Expected a fresh working copy.'));
			const files = readManagedFiles(paths, fixture.project.id);
			bodyPath = files.body;
			blockedDirectory = dirname(bodyPath);
			await chmod(blockedDirectory, 0o500);
			await removeOpenProject(desktop, fixture.project.id);
			assert.equal(projectExists(paths.databasePath, fixture.project.id), false);
			await assert.rejects(stat(files.document), { code: 'ENOENT' });
			assert.deepEqual(Uint8Array.from(await readFile(bodyPath)), fixture.bytes);
			assert.equal(pendingFiles(paths.databasePath), 1);
		} finally { await desktop.close(); }
		const blocked = await startFramescaperDesktopProjectSession(directory);
		try {
			assert.equal(projectExists(paths.databasePath, fixture.project.id), false);
			assert.equal(pendingFiles(paths.databasePath), 1);
		} finally { await blocked.close(); }
	} finally { if (blockedDirectory) await chmod(blockedDirectory, 0o700); }
	const restarted = await startFramescaperDesktopProjectSession(directory);
	try {
		await assert.rejects(stat(bodyPath), { code: 'ENOENT' });
		assert.equal(pendingFiles(paths.databasePath), 0);
	} finally { await restarted.close(); }
});

test('Framescaper Save retires superseded native document generations and retains saved editor history', async context => {
	const { directory, fixture, input } = await authoredArchive(context);
	const archiveBytes = await input.arrayBuffer();
	const paths = createFramescaperDesktopProjectLibraryPaths(directory);
	const indexedDB = createInstrumentedIndexedDB();
	const open = () => startFramescaperDesktopProjectSession(directory, { openEnvironment: () => openFramescaperImageFixtureLibrary(indexedDB) });
	const desktop = await open();
	const projectId = fixture.project.id;
	const superseded = new Set<string>();
	let preserved: string;
	let revisions: readonly unknown[];
	try {
		const { controller } = desktop;
		await controller.actions.project.openScapeFile(input, () => assert.fail('Expected a fresh working copy.'));
		preserved = join(dirname(readManagedFiles(paths, projectId).document), `333-${'c'.repeat(64)}.json`);
		await writeFile(preserved, 'Unregistered native-area file.');
		for (const title of ['First cut', 'Second cut', 'Final cut']) {
			superseded.add(readManagedFiles(paths, projectId).document);
			await controller.actions.project.rename(title);
			await controller.actions.project.save();
		}
		assert.equal(superseded.size, 3);
		revisions = await desktop.environment.store.listProjectRevisions(projectId);
		assert.equal(revisions.length, 4);
	} finally { await desktop.close(); }

	const restarted = await open();
	try {
		await restarted.controller.actions.project.openById(projectId);
		assert.equal(restarted.controller.project?.title, 'Final cut');
		assert.deepEqual(restarted.controller.project?.clips, fixture.project.clips);
		assert.deepEqual(await restarted.environment.store.listProjectRevisions(projectId), revisions);
		const current = readManagedFiles(paths, projectId);
		assert.deepEqual(Uint8Array.from(await readFile(current.body)), fixture.bytes);
		assert.equal(await readFile(preserved, 'utf8'), 'Unregistered native-area file.');
		assert.deepEqual(await input.arrayBuffer(), archiveBytes);
		for (const obsolete of superseded) await assert.rejects(stat(obsolete), { code: 'ENOENT' });
		assert.equal(pendingFiles(paths.databasePath), 0);
	} finally { await restarted.close(); }
});

test('Framescaper Save defers retirement while an admitted native document read is in flight', async context => {
	const { directory, fixture, input } = await authoredArchive(context);
	const paths = createFramescaperDesktopProjectLibraryPaths(directory);
	const projectId = fixture.project.id;
	const desktop = await startFramescaperDesktopProjectSession(directory);
	let previousDocument: string;
	try {
		await desktop.controller.actions.project.openScapeFile(input, () => assert.fail('Expected a fresh working copy.'));
		previousDocument = readManagedFiles(paths, projectId).document;
		const expected = await readFile(previousDocument, 'utf8');
		const observedRead = deferred<void>();
		const allowRead = deferred<void>();
		const nativeReadFile = fileSystem.readFile;
		let armed = true;
		const gate = context.mock.method(fileSystem, 'readFile', async (...args: Parameters<typeof nativeReadFile>) => {
			if (armed && args[0] === previousDocument) {
				armed = false;
				observedRead.resolve();
				await allowRead.promise;
			}
			return nativeReadFile(...args);
		});
		syncBuiltinESMExports();
		const reading = desktop.session.readProjectBundle(projectId);
		void reading.catch(() => undefined);
		try {
			await Promise.race([observedRead.promise, reading.then(() => assert.fail('Expected the native document read to pause.'))]);
			await desktop.controller.actions.project.rename('Updated cut');
			await desktop.controller.actions.project.save();
			assert.equal(pendingFiles(paths.databasePath), 1);
			assert.equal(await readFile(previousDocument, 'utf8'), expected);
		} finally {
			allowRead.resolve();
			gate.mock.restore();
			syncBuiltinESMExports();
			const bundle = await reading;
			assert.ok(bundle && typeof bundle === 'object' && 'document' in bundle);
			assert.equal(bundle.document, expected);
		}
	} finally { await desktop.close(); }
	const restarted = await startFramescaperDesktopProjectSession(directory);
	try {
		await restarted.controller.actions.project.openById(projectId);
		assert.equal(restarted.controller.project?.title, 'Updated cut');
		assert.equal(pendingFiles(paths.databasePath), 0);
		await assert.rejects(stat(previousDocument), { code: 'ENOENT' });
	} finally { await restarted.close(); }
});

async function authoredArchive(context: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-deleted-project-files-'));
	context.after(async () => rm(directory, { recursive: true, force: true }));
	const fixture = await framescaperPortableTimelineImage(directory);
	const source = await openFramescaperImageFixtureLibrary();
	const input = await saveFramescaperImageFixtureArchive(directory, source, fixture).finally(() => source.close());
	return { directory, fixture, input };
}

async function removeOpenProject(desktop: Awaited<ReturnType<typeof startFramescaperDesktopProjectSession>>, projectId: string) {
	await desktop.controller.actions.project.openById(projectId);
	assert.equal(desktop.controller.project?.id, projectId);
	assert.equal(desktop.controller.getSnapshot().readOnly, false);
	await desktop.controller.actions.project.remove(projectId);
}

function readManagedFiles(paths: ReturnType<typeof createFramescaperDesktopProjectLibraryPaths>, projectId: string) {
	const database = new DatabaseSync(paths.databasePath, { readOnly: true });
	try {
		const row = database.prepare('SELECT document_file, bodies_json FROM projects WHERE project_id = ?').get(projectId);
		assert.ok(typeof row?.document_file === 'string' && typeof row.bodies_json === 'string');
		const [descriptor] = JSON.parse(row.bodies_json) as unknown[];
		return { document: join(paths.projectsRoot, row.document_file),
			body: framescaperDesktopExactMediaPath(paths, validateFramescaperDesktopBodyDescriptor(descriptor)) };
	} finally { database.close(); }
}

function projectExists(path: string, projectId: string): boolean {
	const database = new DatabaseSync(path, { readOnly: true });
	try { return database.prepare('SELECT 1 FROM projects WHERE project_id = ?').get(projectId) !== undefined; }
	finally { database.close(); }
}

function pendingFiles(path: string): number {
	const database = new DatabaseSync(path, { readOnly: true });
	try { return Number(database.prepare('SELECT count(*) AS count FROM deleted_project_files').get()?.count); }
	finally { database.close(); }
}
