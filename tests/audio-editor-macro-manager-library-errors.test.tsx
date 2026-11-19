/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { click, macroSnapshot, mountedMacroManagerFixture } from './helpers/macro-manager-fixture.tsx';

test('the manager reports a read-only program library error when New program is chosen', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		fixture.setScriptLibraryReadOnly(true);
		await assert.doesNotReject(click(fixture.button('New program')));
		assert.match(fixture.message(), /read-only/u);
		assert.deepEqual(fixture.scripts.list(), []);
	} finally { fixture.settlePending(); await fixture.cleanup(); }
});

test('a program delete refusal remains visible and keeps the selected program', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button('New program'));
		const original = fixture.scripts.list();
		fixture.setScriptLibraryReadOnly(true);
		await assert.doesNotReject(click(fixture.button('Delete program')));
		assert.match(fixture.message(), /read-only/u);
		assert.deepEqual(fixture.scripts.list(), original);
	} finally { fixture.settlePending(); await fixture.cleanup(); }
});
