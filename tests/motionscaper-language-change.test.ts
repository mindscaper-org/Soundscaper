/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { changeMotionscaperDesktopLocale } from '../src/common/editor/ui/motionscaper/motionscaper-locale.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('Motion language change waits for persistence and retains the real dirty document and undo history', async () => {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	const session = new MotionscaperDocumentSession(store); let release!: (locale: string) => void;
	const persisted = new Promise<string>(resolve => { release = resolve; }); const published: string[] = [];
	try {
		await session.create({ title: 'Saved', width: 32, height: 32, frameRate: { num: 30, den: 1 }, durationFrames: 30 });
		await session.edit([{ type: 'project/rename', title: 'Unpublished edit' }]);
		const before = session.getSnapshot();
		const change = changeMotionscaperDesktopLocale({ set: () => persisted }, 'de', locale => { published.push(locale); });
		await Promise.resolve(); assert.deepEqual(published, []); assert.equal(session.getSnapshot(), before);
		release('de'); await change; assert.deepEqual(published, ['de']); assert.equal(session.getSnapshot(), before);
		assert.equal((await store.loadRecovery(before.project!.id))?.title, 'Unpublished edit');
		assert.equal((await store.load(before.project!.id))?.project.title, 'Saved');
		await session.undo(); assert.equal(session.getSnapshot().project?.title, 'Saved');
		await session.redo(); assert.equal(session.getSnapshot().project?.title, 'Unpublished edit');
	} finally { await session.dispose(); await store.close(); }
});

test('Motion language persistence failures and mismatched receipts cannot publish a new interface locale', async () => {
	const published: string[] = []; const changed = (locale: string) => { published.push(locale); };
	await assert.rejects(changeMotionscaperDesktopLocale({ set: () => Promise.reject(new Error('disk full')) }, 'de', changed), /disk full/u);
	await assert.rejects(changeMotionscaperDesktopLocale({ set: () => Promise.resolve('fr') }, 'de', changed), /different locale/u);
	assert.deepEqual(published, []);
});
