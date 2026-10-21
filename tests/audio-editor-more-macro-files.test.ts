/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroScriptLibrary } from '../src/common/editor/macro-script-library.ts';
import { createMacroScriptLibraryService } from '../src/common/editor/controller/effects/macro-script-library-service.ts';
import { MACRO_SCRIPT_ENGINE, serializeMacroScriptEnvelope } from '../src/common/editor/macro-script-envelope.ts';
import { changeFile, macroSnapshot, mountedMacroManagerFixture } from './helpers/macro-manager-fixture.tsx';

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

