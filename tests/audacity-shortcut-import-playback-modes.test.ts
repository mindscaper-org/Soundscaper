/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';

for (const [version, command, target, key] of [
	['3.0.5', 'PlayLooped', 'action://playback/toggle-play-from-cursor', 'Shift+Space'],
	['3.7.7', 'Play', 'action://playback/play', 'Alt+Space'],
] as const) test(`Audacity ${version} ${command} cannot overwrite a different playback mode`, () => {
	const current = { [target]: ['Ctrl+P'] };
	const plan = parseAudacityShortcutImport(`<audacitykeyboard audacityversion="${version}">
		<command name="${command}" key="${key}"/>
	</audacitykeyboard>`, current, { availableActionIds: [target, 'toggle-loop-region', 'action://playback/toggle-play-stop'] });
	assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.shortcuts, current);
});

test('supported legacy play-stop and pause modes still import independently', () => {
	const plan = parseAudacityShortcutImport(`<audacitykeyboard audacityversion="3.7.7">
		<command name="Play/Stop" key="Space"/><command name="Pause" key="P"/>
	</audacitykeyboard>`, {}, { availableActionIds: ['action://playback/toggle-play-stop', 'action://playback/pause'] });
	assert.equal(plan.importedCount, 2);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'action://playback/toggle-play-stop': ['Space'], 'action://playback/pause': ['P'] });
});
