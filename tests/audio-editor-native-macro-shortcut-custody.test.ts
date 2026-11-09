/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importShortcutPreferences } from './helpers/shortcut-import-custody.ts';

for (const commands of [['SortByName'], ['SortByTime'], ['Disjoin'], ['SelectAll', 'SelAllTracks'], ['SelNextClip', 'SelPrevClip']]) {
	test(`native ${commands.join('/')} shortcut review leaves durable local bindings unchanged`, async context => {
		const xml = `<audacitykeyboard audacityversion="3.7.7">${commands.map((command, index) =>
			`<command name="${command}" key="Ctrl+Alt+Shift+F${index + 7}"/>`).join('')}</audacitykeyboard>`;
		const { plan, before, persisted, saves } = await importShortcutPreferences(context, xml,
			{ 'sort-by-name': ['Alt+N'], 'sort-by-time': ['Alt+T'], 'select-all': ['Ctrl+A'], 'split-delete': ['Alt+D'], 'select-next-clip': ['Alt+Right'] });
		assert.equal(plan.importedCount, 0);
		assert.deepEqual(plan.skipped, commands.map(command => ({ command, reason: 'unsupported-command' })));
		assert.equal(saves, 0);
		assert.deepEqual(persisted, before);
	});
}
