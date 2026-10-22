/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { motionLaunchPaths } from '../desktop/motionscaper-launch-authority.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { ACCEPTED_PROJECT_FILE_EXTENSIONS } from '../src/common/project-file-extensions.ts';
import { selectMotionscaperDesktopArchive, type MotionDesktopArchiveInput } from '../src/motionscaper/desktop-file-adapter.ts';
import { takeMotionscaperDesktopLaunch } from '../src/motionscaper/desktop-launch-adapter.ts';
import type { MotionDesktopFiles } from '../src/motionscaper/desktop-file-contract.ts';
import { openMotionscaperDesktopArchiveSelection, writeMotionscaperDesktopProject } from '../src/motionscaper/editor-document-desktop.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const settings = { title: 'Native original', width: 32, height: 32, frameRate: { num: 30, den: 1 }, durationFrames: 2 };
function fixture() {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	return { store, session: new MotionscaperDocumentSession(store) };
}
async function openAdobe(session: MotionscaperDocumentSession, selected: MotionDesktopArchiveInput, onAdobe: (name: string) => void): Promise<unknown> {
	return await openMotionscaperDesktopArchiveSelection(session, selected, undefined, undefined, onAdobe);
}
function unreadable(name: string, release: () => Promise<void>): MotionDesktopArchiveInput {
	return { name, input: createScapeArchiveByteSource({ size: 32, maximumReadBytes: 32,
		read: async () => { throw new Error('Adobe project bytes must not be read.'); } }),
		bind: async () => { throw new Error('Adobe project must not replace the native save binding.'); }, release };
}

for (const name of ['Original.aep', 'Original.AEPX']) test(`native Adobe selection ${name} routes by name, releases once and preserves dirty history and bound Save`, async () => {
	const root = await mkdtemp(join(tmpdir(), 'motion-native-ae-')), original = join(root, 'original.mscape'), adobe = join(root, name);
	await writeFile(adobe, 'untouched Adobe source bytes');
	let saveChoices = 0, reads = 0, binds = 0, releases = 0;
	const authority = createMotionscaperFileAuthority({ chooseOpen: async () => adobe, chooseSave: async () => { saveChoices++; return original; } });
	const files = { ...authority, read: async () => { reads++; throw new Error('Adobe project bytes must not be read.'); },
		bindOpened: async () => { binds++; throw new Error('Adobe cannot bind.'); },
		release: async (request: { token: string }) => { releases++; await authority.release(request); } };
	const { session, store } = fixture();
	try {
		await session.create(settings); await session.save(project => writeMotionscaperDesktopProject(project, store, files));
		await session.changeSettings({ ...settings, title: 'Unsaved native draft' });
		const before = session.getSnapshot(), disk = await readFile(original), events: string[] = [];
		assert.equal(before.dirty, true); assert.equal(before.canUndo, true);
		const selected = await selectMotionscaperDesktopArchive(files); assert.ok(selected);
		const wrapped = { ...selected, release: async () => { events.push('release'); await selected.release(); } };
		assert.equal(await openAdobe(session, wrapped, filename => { assert.equal(filename, name); events.push('bridge'); }), 'after-effects');
		assert.deepEqual(events, ['bridge', 'release']); assert.equal(reads, 0); assert.equal(binds, 0); assert.equal(releases, 1);
		assert.deepEqual(session.getSnapshot(), before); assert.deepEqual(await readFile(original), disk);
		await session.undo(); assert.equal(session.getSnapshot().project?.title, 'Native original');
		await session.redo(); assert.equal(session.getSnapshot().project?.title, 'Unsaved native draft');
		await session.save(project => writeMotionscaperDesktopProject(project, store, files));
		assert.equal(saveChoices, 1, 'Save still uses the previously bound .mscape destination');
		assert.notDeepEqual(await readFile(original), disk); assert.equal(await readFile(adobe, 'utf8'), 'untouched Adobe source bytes');
	} finally { await session.dispose(); await store.close(); await authority.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('native Adobe cleanup failure keeps the intended bridge route and allows retry without project mutation', async () => {
	const { session, store } = fixture(); const cleanup = new Error('Native close failed.'); let attempts = 0, routes = 0;
	const selected = unreadable('Retry.aep', async () => { if (++attempts === 1) throw cleanup; });
	try {
		await session.create(settings); await session.changeSettings({ ...settings, title: 'Dirty before retry' }); const before = session.getSnapshot();
		await assert.rejects(openAdobe(session, selected, () => { routes++; }), error => error === cleanup);
		assert.equal(routes, 1); assert.equal(attempts, 1); assert.deepEqual(session.getSnapshot(), before);
		await selected.release(); assert.equal(attempts, 2); assert.equal(routes, 1); assert.deepEqual(session.getSnapshot(), before);
	} finally { await session.dispose(); await store.close(); }
});

test('native Adobe route preserves close then ACK retry semantics without reading or binding launch bytes', async () => {
	const { session, store } = fixture(); const events: string[] = []; let failClose = true, failAck = true;
	const files: MotionDesktopFiles = { selectOpen: async () => null,
		read: async () => { throw new Error('No Adobe byte read.'); }, bindOpened: async () => { throw new Error('No Adobe binding.'); },
		release: async () => { events.push('close'); if (failClose) { failClose = false; throw new Error('Close denied.'); } },
		beginSave: async () => null, write: async () => undefined, commit: async () => { throw new Error('No save.'); }, cancel: async () => undefined };
	const launch = { take: async () => ({ token: 'adobe', name: 'Warm.aepx', byteLength: 32 }),
		acknowledge: async () => { events.push('ack'); if (failAck) { failAck = false; throw new Error('ACK denied.'); } }, onPending: () => () => undefined };
	try {
		const selected = await takeMotionscaperDesktopLaunch(files, launch); assert.ok(selected);
		await assert.rejects(openAdobe(session, selected, () => { events.push('bridge'); }), /Close denied/u);
		assert.deepEqual(events, ['bridge', 'close']);
		await assert.rejects(selected.release(), /ACK denied/u); assert.deepEqual(events, ['bridge', 'close', 'close', 'ack']);
		await selected.release(); await selected.release(); assert.deepEqual(events, ['bridge', 'close', 'close', 'ack', 'ack']);
		assert.equal(session.getSnapshot().project, null);
	} finally { await session.dispose(); await store.close(); }
});

test('Adobe suffixes remain outside global Scape project and OS launch admission', async () => {
	assert.equal(ACCEPTED_PROJECT_FILE_EXTENSIONS.some(extension => /aep/iu.test(extension)), false);
	assert.deepEqual(motionLaunchPaths(['Original.aep', 'Original.AEPX'], '/tmp'), []);
	const source = await readFile(new URL('../desktop/motionscaper-main.ts', import.meta.url), 'utf8');
	assert.match(source, /motionscaperAfterEffectsBridge[\s\S]{0,100}extensions:\s*\['aep',\s*'aepx'\]/u);
});

test('the core archive owner refuses Adobe bytes when no bridge callback is available', async () => {
	const { session, store } = fixture(); let released = 0;
	try {
		await assert.rejects(openMotionscaperDesktopArchiveSelection(session, unreadable('Original.aep', async () => { released++; })), /After Effects Bridge/u);
		assert.equal(released, 1); assert.equal(session.getSnapshot().project, null);
	} finally { await session.dispose(); await store.close(); }
});
