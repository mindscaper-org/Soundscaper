/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroScriptLibraryService } from '../src/common/editor/controller/effects/macro-script-library-service.ts';
import { createMacroScriptLibrary, macroScriptIsRunnable } from '../src/common/editor/macro-script-library.ts';

function library() {
	let nextId = 0;
	return createMacroScriptLibraryService({
		state: { macroScripts: createMacroScriptLibrary() },
		createId: prefix => `${prefix}-${++nextId}`,
		persistSetting: async () => {},
		publishDocumentSnapshot: () => {},
		handleError: error => { throw error; },
	});
}

test('exported and imported programs remain runnable when either copy is removed', async () => {
	const service = library();
	const original = service.save({ name: 'My programme', source: "sound.log.info('Hello');" });
	const imported = service.import(service.export(original.id), 'my-programme.soundscapemacro');
	assert.equal(macroScriptIsRunnable(original), true);
	assert.equal(macroScriptIsRunnable(imported), true);
	assert.equal(service.blocked(original.source), false);
	service.delete(original.id);
	assert.equal(service.blocked(imported.source), false, 'each imported copy can run independently');
	await service.flush();
});

test('duplicate imports and their edits can run without approval', async () => {
	const service = library();
	const original = service.save({ name: 'Programme', source: 'sound.log.info(1);' });
	const file = service.export(original.id);
	service.delete(original.id);
	const first = service.import(file, 'programme.soundscapemacro');
	const second = service.import(file, 'programme.soundscapemacro');
	assert.equal(service.blocked(first.source), false);
	assert.equal(service.blocked(first.source), false);
	service.save({ ...service.list().find(item => item.id === first.id)!, source: 'sound.log.info(2);' });
	assert.equal(service.blocked(second.source), false);
	assert.equal(service.blocked('sound.log.info(2);'), false, 'edited programs need only an explicit Run action');
	await service.flush();
});
