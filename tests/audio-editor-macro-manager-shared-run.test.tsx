/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { changeFile, click, macroSnapshot, mountedMacroManagerFixture } from './helpers/macro-manager-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

test('the footer Run macro button runs the selected program and then the selected step macro', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await act(async () => { fixture.scripts.save({ name: 'Program', source: 'await sound.select.all();' }); });
		await click(fixture.program('Program'));
		assert.equal(reactProps(fixture.button(ENGLISH_COPY.runMacro)).disabled, false);
		assert.equal(fixture.buttonLabels().filter((label) => label.endsWith(ENGLISH_COPY.runMacro)).length, 1);
		assert.equal(fixture.buttonLabels().includes('Run program'), false);
		assert.equal(fixture.find('.audio-editor-macro-script__actions'), null);
		await click(fixture.button(ENGLISH_COPY.runMacro));
		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.equal(fixture.scriptRuns.length, 1, 'a second click cannot start another program');
		assert.equal(fixture.runs.length, 0, 'the program must not fall through to the step runner');
		assert.equal(reactProps(fixture.button(ENGLISH_COPY.runMacro)).disabled, true);
		assert.equal(fixture.buttonLabels().filter((label) => label === 'Cancel run').length, 1);
		await act(async () => {
			fixture.scriptRuns[0]!.settlement.resolve({ log: [] });
			await Promise.resolve();
		});
		assert.equal(fixture.find('[data-macro-script-log]')?.getAttribute('data-outcome'), 'completed');
		assert.equal(reactProps(fixture.button(ENGLISH_COPY.runMacro)).disabled, false);
		await click(fixture.macro('Portable chain'));
		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.equal(fixture.runs.length, 1);
		assert.equal(fixture.scriptRuns.length, 1);
	} finally {
		for (const run of fixture.scriptRuns) run.settlement.resolve({ log: [] });
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('the footer disables an empty program and cancels a running program', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await act(async () => {
			fixture.scripts.save({ name: 'Empty', source: '  ' });
			fixture.scripts.save({ name: 'Long program', source: 'await sound.select.all();' });
		});
		await click(fixture.program('Empty'));
		assert.equal(reactProps(fixture.button(ENGLISH_COPY.runMacro)).disabled, true);
		await click(fixture.program('Long program'));
		await click(fixture.button(ENGLISH_COPY.runMacro));
		await click(fixture.button('Cancel run'));
		assert.equal(fixture.cancels(), 1);
		await act(async () => {
			fixture.scriptRuns[0]!.settlement.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
			await Promise.resolve();
		});
		assert.equal(fixture.find('[data-macro-script-log]')?.getAttribute('data-outcome'), 'cancelled');
		assert.equal(reactProps(fixture.button(ENGLISH_COPY.runMacro)).disabled, false);
	} finally {
		for (const run of fixture.scriptRuns) run.settlement.resolve({ log: [] });
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('selecting a program preserves the footer cancellation for a pending step macro', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await act(async () => { fixture.scripts.save({ name: 'Program', source: 'await sound.select.all();' }); });
		await click(fixture.button(ENGLISH_COPY.runMacro));
		await click(fixture.program('Program'));
		assert.equal(reactProps(fixture.button(ENGLISH_COPY.runMacro)).disabled, true);
		assert.equal(fixture.buttonLabels().filter((label) => label === 'Cancel run').length, 1);
		await act(async () => {
			fixture.runs[0]!.settlement.resolve(true);
			await Promise.resolve();
		});
		assert.equal(reactProps(fixture.button(ENGLISH_COPY.runMacro)).disabled, false);
		assert.equal(fixture.scriptRuns.length, 0);
		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.equal(fixture.scriptRuns.length, 1);
	} finally {
		for (const run of fixture.scriptRuns) run.settlement.resolve({ log: [] });
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('the shared button runs an imported copy without approval even when its text matches another program', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		const source = 'await sound.select.all();';
		await act(async () => { fixture.scripts.save({ name: 'Authored', source }); });
		await changeFile(fixture.importScriptInput(), new File([JSON.stringify({
			schemaVersion: 1, kind: 'script', engine: 'soundscaper-macro-js/1', name: 'Imported copy', source,
		})], 'copy.soundscapemacro'));
		assert.equal(fixture.scripts.list().at(-1)?.trust, 'imported-untrusted');
		assert.equal(fixture.scripts.blocked(source), false, 'source availability does not depend on legacy review markers');
		assert.equal(reactProps(fixture.button(ENGLISH_COPY.runMacro)).disabled, false);
		assert.equal(fixture.scriptRuns.length, 0);
		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.equal(fixture.scriptRuns.length, 1);
	} finally {
		for (const run of fixture.scriptRuns) run.settlement.resolve({ log: [] });
		fixture.settlePending();
		await fixture.cleanup();
	}
});
