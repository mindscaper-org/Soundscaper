/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The dialog chrome and the export surface split into two files when the
// combined one outgrew the maintainability ceiling; the no-blur rule below
// covers both, so both are read.
const DIALOG_STYLE_FILES = [
	'../src/common/editor/ui/audio-editor-design-system/11-panels-dialogs-generators.css',
	'../src/common/editor/ui/audio-editor-design-system/10b-dialog-export.css',
].map((path) => new URL(path, import.meta.url));

test('track-rate submission uses the retained track and preserves async settlement', async () => {
	const { applyTrackRateDialog, TRACK_RATE_DIALOG_MISSING_TRACK } = await import(
		'../src/common/editor/ui/dialogs/editor-dialog-model.js'
	);
	const calls: unknown[][] = [];
	const updated = Promise.resolve('updated');
	const applied = applyTrackRateDialog({
		trackId: 'menu-track-b',
		value: '96000',
		run: (operation: () => unknown) => operation(),
		setRate: (...args: unknown[]) => { calls.push(args); return updated; },
	});
	assert.equal(applied, updated, 'the dialog model must preserve async action settlement');
	assert.deepEqual(calls, [['menu-track-b', 96_000]]);
	assert.equal(applyTrackRateDialog({
		trackId: null,
		value: '48000',
		run: () => { throw new Error('missing tracks must not run'); },
		setRate: () => undefined,
	}), TRACK_RATE_DIALOG_MISSING_TRACK);
});

test('dialog surfaces use a drop shadow without blurring the editor behind them', async () => {
	const styles = (await Promise.all(DIALOG_STYLE_FILES.map((file) => readFile(file, 'utf8')))).join('\n');
	assert.doesNotMatch(styles, /backdrop-filter\s*:/u);
	assert.match(
		styles,
		/\.kw-audio-editor-dialog\s*\{[^}]*box-shadow:\s*0 24px 80px rgba\(0, 0, 0, 0\.38\);/su,
	);
});

test('the shared dialog frame outranks the export dialog that also wears it', async () => {
	// The shell puts `kw-audio-editor-dialog` and `audio-editor-export-dialog` on
	// one element, and both frame rules are `#id .class`, so nothing but source
	// order decides the radius and drop shadow. Splitting the stylesheet by size
	// once moved the export rules after the chrome and silently reframed the
	// dialog, so the order the imports produce is asserted rather than assumed.
	const root = new URL('../src/common/editor/ui/audio-editor-design-system.css', import.meta.url);
	const imported = [...(await readFile(root, 'utf8')).matchAll(/^@import '\.\/audio-editor-design-system\/([^']+)';$/gmu)]
		.map((match) => match[1]);
	const [exportStyles, chromeStyles] = ['10b-dialog-export.css', '11-panels-dialogs-generators.css'];

	assert.ok(imported.includes(exportStyles) && imported.includes(chromeStyles),
		'both dialog stylesheets must still be imported by the design system');
	assert.ok(imported.indexOf(exportStyles) < imported.indexOf(chromeStyles),
		`${exportStyles} must precede ${chromeStyles}, or it overrides the shared frame's radius and shadow`);

	const exportSheet = await readFile(new URL(`audio-editor-design-system/${exportStyles}`, root), 'utf8');
	const chromeSheet = await readFile(new URL(`audio-editor-design-system/${chromeStyles}`, root), 'utf8');
	assert.match(exportSheet, /:is\(\.audio-editor-export-dialog, \.audio-editor-local-dialog\) \{[^}]*border-radius:/su);
	assert.match(chromeSheet, /\.kw-audio-editor-dialog \{[^}]*border-radius:/su);
});
