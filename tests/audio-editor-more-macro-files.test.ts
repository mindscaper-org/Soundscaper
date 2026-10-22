/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createMacroScriptLibrary } from '../src/common/editor/macro-script-library.ts';
import { createMacroScriptLibraryService } from '../src/common/editor/controller/effects/macro-script-library-service.ts';
import { MACRO_SCRIPT_ENGINE, serializeMacroScriptEnvelope } from '../src/common/editor/macro-script-envelope.ts';
import { changeFile, click, deferred, macroSnapshot, mountedMacroManagerFixture } from './helpers/macro-manager-fixture.tsx';

function service() {
	let id = 0;
	return createMacroScriptLibraryService({ state: { macroScripts: createMacroScriptLibrary() },
		createId: (prefix) => `${prefix}-${String(++id)}`, persistSetting: async () => undefined,
		publishDocumentSnapshot() {}, handleError(error) { throw error; },
	});
}

test('MP15: exported macro programs with escape-heavy comments can be imported again', () => {
	const library = service();
	const source = `/*${'\u0001'.repeat(256 * 1024 - 4)}*/`;
	const script = library.save({ name: 'Comment', source });
	const imported = library.import(library.export(script.id), 'Comment.soundscapemacro');
	assert.equal(imported.source, source);
});

test('MP16: macro import refuses a future engine instead of silently treating it as current source', () => {
	const library = service();
	const envelope = JSON.parse(serializeMacroScriptEnvelope({ name: 'Future', source: '' })) as Record<string, unknown>;
	envelope.engine = MACRO_SCRIPT_ENGINE.replace('/1', '/2');
	assert.throws(() => library.import(JSON.stringify(envelope)), /Unsupported macro program engine/u);
	assert.equal(library.list().length, 0);
});

test('MP15 manager route admits the encoded program bytes exported from its valid source editor state', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		const source = `/*${'\u0001'.repeat(256 * 1024 - 4)}*/`;
		const file = new File([serializeMacroScriptEnvelope({ name: 'Comment', source })], 'Comment.soundscapemacro');
		assert.ok(file.size > 1024 * 1024);
		const input = fixture.find('[data-macro-script-import-file]');
		assert.ok(input);
		await changeFile(input, file);
		assert.equal(fixture.scripts.list()[0]?.source, source);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});


for (const sameId of [false, true]) test(`MP34: a pending program import cannot replace a later ${sameId ? 'same-ID' : 'different-ID'} manager selection`, async () => {
	const fixture = await mountedMacroManagerFixture();
	const text = deferred<string>();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await changeFile(fixture.importScriptInput(), { name: 'Old.soundscapemacro', size: 100,
			text: () => text.promise } as File);
		await fixture.render(macroSnapshot(sameId ? 'project-a' : 'project-b'), sameId);
		await changeFile(fixture.importScriptInput(), new File([
			serializeMacroScriptEnvelope({ name: 'New program', source: 'await sound.select.all();' }),
		], 'New.soundscapemacro'));
		assert.ok(fixture.selectedProgramName()?.startsWith('New program'));
		await act(async () => {
			text.resolve(serializeMacroScriptEnvelope({ name: 'Old program', source: 'await sound.select.none();' }));
			await text.promise;
			await Promise.resolve();
		});
		assert.ok(fixture.selectedProgramName()?.startsWith('New program'));
		assert.deepEqual(fixture.scripts.list().map(({ name }) => name), ['New program']);
	} finally {
		text.resolve(''); fixture.settlePending(); await fixture.cleanup();
	}
});

for (const sameId of [false, true]) test(`MP35: replacing a ${sameId ? 'same-ID' : 'different-ID'} project releases pending program run ownership`, async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await act(async () => { fixture.scripts.save({ name: 'Shared program', source: 'await sound.select.all();' }); });
		await click(fixture.program('Shared program'));
		await click(fixture.button('Run program'));
		assert.equal(fixture.scriptRuns.length, 1);
		await fixture.render(macroSnapshot(sameId ? 'project-a' : 'project-b'), sameId);
		assert.ok(fixture.buttonLabels().includes('Run program'), 'the new project must not inherit the old run admission');
		await click(fixture.button('Run program'));
		assert.equal(fixture.scriptRuns.length, 2);
		await act(async () => { fixture.scriptRuns[0]!.settlement.resolve({ log: [] }); await Promise.resolve(); });
		assert.equal(fixture.buttonLabels().includes('Run program'), false, 'old completion cannot release the new run');
	} finally {
		for (const run of fixture.scriptRuns) run.settlement.resolve({ log: [] });
		fixture.settlePending(); await fixture.cleanup();
	}
});


test('MP34 ancillary: a pending program file retires on same-ID native replacement without a newer import', async () => {
	const fixture = await mountedMacroManagerFixture(); const text = deferred<string>();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await changeFile(fixture.importScriptInput(), { name: 'Old.soundscapemacro', size: 100, text: () => text.promise } as File);
		await fixture.render(macroSnapshot('project-a'), true);
		await act(async () => { text.resolve(serializeMacroScriptEnvelope({ name: 'Old program', source: '' }));
			await text.promise; await Promise.resolve(); });
		assert.deepEqual(fixture.scripts.list(), []);
	} finally { text.resolve(''); fixture.settlePending(); await fixture.cleanup(); }
});
