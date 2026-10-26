/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createShortcutImportSession, type ShortcutImportSource } from '../src/common/editor/controller/preferences/shortcut-import-session.ts';
import { AUDACITY_SHORTCUT_IMPORT_MAX_BYTES, parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';

const importer = { AUDACITY_SHORTCUT_IMPORT_MAX_BYTES, parseAudacityShortcutImport };
const plan = parseAudacityShortcutImport('<audacitykeyboard><command name="NewMonoTrack" key="Alt+N"/></audacitykeyboard>', {});

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

function fixture(options: {
	readonly loadImporter?: () => Promise<typeof importer>;
	readonly saveShortcuts?: (shortcuts: typeof plan.shortcuts) => unknown;
} = {}) {
	const sources: (ShortcutImportSource | null)[] = [];
	const busy: boolean[] = [];
	const errors: ('invalid' | 'too-large' | null)[] = [];
	const imported: (number | null)[] = [];
	const saved: (typeof plan.shortcuts)[] = [];
	const session = createShortcutImportSession({
		loadImporter: options.loadImporter ?? (() => Promise.resolve(importer)),
		saveShortcuts: options.saveShortcuts ?? ((shortcuts) => { saved.push(shortcuts); }),
		onSource: (source) => { sources.push(source); },
		onBusy: (value) => { busy.push(value); },
		onReadError: (error) => { errors.push(error); },
		onImported: (count) => { imported.push(count); },
	});
	return { session, sources, busy, errors, imported, saved };
}

test('shortcut import reads through injected resources and publishes the parser with its source', async () => {
	const state = fixture();
	await state.session.read({ size: 4, text: () => Promise.resolve('<xml/>') });
	assert.deepEqual(state.sources, [null, { xml: '<xml/>', parse: parseAudacityShortcutImport }]);
	assert.deepEqual(state.busy, [true, false]);
	assert.deepEqual(state.errors, [null]);
	assert.deepEqual(state.imported, [null]);
	assert.deepEqual(state.saved, []);
});

test('oversized shortcut files are rejected before reading their bytes', async () => {
	const state = fixture();
	let read = false;
	await state.session.read({ size: AUDACITY_SHORTCUT_IMPORT_MAX_BYTES + 1, text: () => {
		read = true;
		return Promise.resolve('');
	} });
	assert.equal(read, false);
	assert.deepEqual(state.errors, [null, 'too-large']);
	assert.deepEqual(state.busy, [true, false]);
});

test('reading and loading failures reset busy state and report an invalid file', async () => {
	const load = fixture({ loadImporter: () => Promise.reject(new Error('import failed')) });
	await load.session.read({ size: 1, text: () => Promise.resolve('') });
	assert.deepEqual(load.errors, [null, 'invalid']);
	assert.deepEqual(load.busy, [true, false]);
	const read = fixture();
	await read.session.read({ size: 1, text: () => Promise.reject(new Error('read failed')) });
	assert.deepEqual(read.errors, [null, 'invalid']);
	assert.deepEqual(read.busy, [true, false]);
});

test('a newer read owns the preview even if an older read finishes last', async () => {
	const old = deferred<string>();
	const state = fixture();
	const pending = state.session.read({ size: 1, text: () => old.promise });
	await Promise.resolve();
	await state.session.read({ size: 1, text: () => Promise.resolve('new') });
	old.resolve('old');
	await pending;
	assert.deepEqual(state.sources, [null, null, { xml: 'new', parse: parseAudacityShortcutImport }]);
	assert.deepEqual(state.busy, [true, true, false]);
});

test('cancel invalidates a pending read and allows another import', async () => {
	const old = deferred<string>();
	const state = fixture();
	const pending = state.session.read({ size: 1, text: () => old.promise });
	await Promise.resolve();
	state.session.cancel();
	old.reject(new Error('late failure'));
	await pending;
	assert.deepEqual(state.errors, [null, null]);
	assert.deepEqual(state.busy, [true, false]);
	assert.deepEqual([...state.sources], [null, null]);
	await state.session.read({ size: 1, text: () => Promise.resolve('next') });
	assert.equal(state.sources.at(-1)?.xml, 'next');
});

test('apply waits for persistence, blocks reentry, and clears the review after a durable save', async () => {
	const save = deferred<void>();
	let saves = 0;
	const state = fixture({ saveShortcuts: (shortcuts) => {
		assert.deepEqual(shortcuts, plan.shortcuts);
		saves += 1;
		return save.promise;
	} });
	await state.session.read({ size: 1, text: () => Promise.resolve('source') });
	const applying = state.session.apply(plan);
	await state.session.apply(plan);
	await state.session.read({ size: 1, text: () => Promise.resolve('ignored') });
	state.session.cancel();
	assert.equal(saves, 1);
	assert.deepEqual(state.imported, [null, null]);
	assert.equal(state.sources.at(-1)?.xml, 'source');
	save.resolve();
	await applying;
	assert.deepEqual(state.imported, [null, null, 1]);
	assert.equal(state.sources.at(-1), null);
	assert.deepEqual(state.busy, [true, false, true, false]);
});

test('a rejected save preserves the source for retry and never reports success', async () => {
	let saves = 0;
	const state = fixture({ saveShortcuts: () => {
		saves += 1;
		if (saves === 1) return Promise.reject(new Error('storage full'));
	} });
	await state.session.read({ size: 1, text: () => Promise.resolve('source') });
	await state.session.apply(plan);
	assert.equal(state.sources.at(-1)?.xml, 'source');
	assert.deepEqual(state.imported, [null, null]);
	await state.session.apply(plan);
	assert.equal(state.imported.at(-1), 1);
});

test('disposal is idempotent and suppresses late reads, saves, and future calls', async () => {
	const old = deferred<string>();
	const state = fixture();
	const reading = state.session.read({ size: 1, text: () => old.promise });
	state.session.dispose();
	state.session.dispose();
	old.resolve('late');
	await reading;
	await state.session.apply(plan);
	await state.session.read({ size: 1, text: () => Promise.resolve('ignored') });
	state.session.cancel();
	assert.deepEqual(state.sources, [null]);
	assert.deepEqual(state.busy, [true]);
	assert.deepEqual(state.saved, []);
	const save = deferred<void>();
	const applying = fixture({ saveShortcuts: () => save.promise });
	const pending = applying.session.apply(plan);
	applying.session.dispose();
	save.resolve();
	await pending;
	assert.deepEqual(applying.imported, [null]);
	assert.deepEqual(applying.busy, [true]);
});
