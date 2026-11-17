/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroSelfEdit } from '../src/common/editor/controller/effects/internal/macro/macro-self-edit.ts';
import { createMacroScriptHost } from '../src/common/editor/controller/effects/internal/macro/macro-script-host.ts';
import { createMacroScriptLibraryService, createInitialMacroScriptLibrary } from '../src/common/editor/controller/effects/macro-script-library-service.ts';

function harness() {
	const state = { macroScripts: createInitialMacroScriptLibrary(), macroScriptsReadOnly: false };
	const writes: unknown[] = [];
	const library = createMacroScriptLibraryService({ state, createId: () => 'minted',
		persistSetting: async (_key, value) => { writes.push(value); },
		publishDocumentSnapshot() {}, handleError(error) { throw error; },
	});
	const original = library.save({ id: 'self', name: 'Bookmark', source: 'original' });
	return { library, state, writes, original, self: () => createMacroSelfEdit(library, original.source, original.id) };
}

for (const conflict of ['edit', 'rename', 'delete', 'read-only'] as const) test(`a queued self edit preserves a concurrent ${conflict}`, () => {
	const { library, original, state, self: begin } = harness();
	const self = begin();
	self.replaceSource('next');
	if (conflict === 'edit') library.save({ ...original, source: 'user edit' });
	if (conflict === 'rename') library.save({ ...original, name: 'Renamed by user' });
	if (conflict === 'delete') library.delete(original.id);
	if (conflict === 'read-only') state.macroScriptsReadOnly = true;
	const before = library.list();
	assert.throws(() => self.commit(), /changed|read-only/u);
	self.rollback();
	assert.deepEqual(library.list(), before);
});

test('source replacement validates types and bounds before staging, and repeated writes keep the last source', async () => {
	const { library, original, self: begin } = harness();
	const self = begin();
	for (const value of [null, {}, 1, false]) assert.throws(() => self.replaceSource(value), /string/u);
	assert.throws(() => self.replaceSource('x'.repeat(262145)), /too large/u);
	assert.equal(self.source(), original.source);
	self.replaceSource('first'); self.replaceSource('second');
	assert.equal(self.source(), 'second');
	assert.equal(library.list()[0]?.source, 'original', 'staging does not publish');
	self.commit(); await library.flush();
	assert.equal(library.list()[0]?.source, 'second');
});

test('a refused project commit compensates a published self edit without losing its original error', async () => {
	const { library, original, self: begin } = harness();
	const self = begin();
	const host = createMacroScriptHost({
		getProject: () => ({ id: 'project', tracks: [] }), projectSampleRate: () => 48000,
		runEffectMacro: async () => undefined, runMacroCommand() {}, setExactSelection() {}, listSavedMacros: () => [],
		beginMacroTransaction: () => ({ assertCurrent() {}, commit() { throw new Error('Commit refused'); }, rollback() {} }),
	});
	await assert.rejects(host.runMacroScript({ name: original.name, self, run: async dispatch => {
		await dispatch('self.replaceSource', ['next']);
	} }), /Commit refused/u);
	assert.deepEqual(library.list()[0], original);
	await library.flush();
});

test('rollback cannot overwrite an edit made after self publication', () => {
	const { library, original, self: begin } = harness();
	const self = begin(); self.replaceSource('next'); self.commit();
	library.save({ ...original, source: 'newer user edit' });
	self.rollback();
	assert.equal(library.list()[0]?.source, 'newer user edit');
});

test('program cancellation discards the staged source even when the program catches the next rejection', async () => {
	const { library, original, self: begin } = harness();
	const host = createMacroScriptHost({
		getProject: () => ({ id: 'project', tracks: [] }), projectSampleRate: () => 48000,
		runEffectMacro: async () => undefined, runMacroCommand() {}, setExactSelection() {}, listSavedMacros: () => [],
		beginMacroTransaction: () => ({ assertCurrent() {}, commit() {}, rollback() {} }),
	});
	await assert.rejects(host.runMacroScript({ name: original.name, self: begin(), run: async dispatch => {
		await dispatch('self.replaceSource', ['next']);
		host.cancelMacroScript();
		await assert.rejects(dispatch('self.source', []), { name: 'AbortError' });
	} }), { name: 'AbortError' });
	assert.deepEqual(library.list()[0], original);
});
