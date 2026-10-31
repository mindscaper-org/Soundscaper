/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MUSESCORE_ICON_CODES } from '../src/common/editor/audacity-iconcodes.js';
import { normalizeCustomToolbarButtons } from '../src/common/editor/custom-toolbar-buttons.ts';
import { createCustomToolbarButtonImage, isCustomToolbarButtonImage, MAX_CUSTOM_TOOLBAR_IMAGE_BYTES } from '../src/common/editor/custom-toolbar-button-image.ts';
import {
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
	createCustomAudioEditorWorkspace,
	deleteCustomAudioEditorWorkspace,
	loadAudioEditorPreferencesV1,
	updateAudioEditorPreferencesV1,
	validateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';

const BUTTON = { id: 'custom-split', name: 'Split selection', icon: 'CUT', actionId: 'split' };
const SVG_ICON = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>')}`;

test('image symbols detect PNG and UTF-8 SVG content and bound persisted bytes', () => {
	const svg = new TextEncoder().encode('<?xml version="1.0"?>\n<!-- Symbol -->\n<svg xmlns="http://www.w3.org/2000/svg"><title>音</title></svg>');
	assert.equal(isCustomToolbarButtonImage(createCustomToolbarButtonImage(svg)), true);
	const png = new Uint8Array(MAX_CUSTOM_TOOLBAR_IMAGE_BYTES);
	png.set([137, 80, 78, 71, 13, 10, 26, 10]);
	assert.equal(isCustomToolbarButtonImage(createCustomToolbarButtonImage(png)), true);
	assert.throws(() => createCustomToolbarButtonImage(new Uint8Array(MAX_CUSTOM_TOOLBAR_IMAGE_BYTES + 1)), RangeError);
	assert.throws(() => createCustomToolbarButtonImage(new Uint8Array()), RangeError);
	assert.throws(() => createCustomToolbarButtonImage(new TextEncoder().encode('GIF89a')), RangeError);
});

test('uploaded symbols survive preference persistence and workspace changes', () => {
	const button = { ...BUTTON, icon: SVG_ICON };
	const preferences = createAudioEditorPreferencesV1({ workspace: { customButtons: [button] } });
	const restored = loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(preferences)) as unknown);
	assert.deepEqual(restored.preferences.workspace.customButtons, [button]);
	assert.deepEqual(applyAudioEditorWorkspace(restored.preferences, 'classic').workspace.customButtons, [button]);
});

test('uploaded symbols reject remote URLs, unsupported types, malformed data and oversized payloads', () => {
	for (const icon of ['https://example.com/icon.svg', 'data:text/html;base64,PHN2Zz4=',
		'data:image/svg+xml;base64,???', `data:image/svg+xml;base64,${btoa('<html/>')}`,
		`data:image/png;base64,${btoa('not a PNG')}`, `data:image/svg+xml;base64,${'A'.repeat(400_000)}`]) {
		assert.throws(() => normalizeCustomToolbarButtons([{ ...BUTTON, icon }]), RangeError);
	}
});

test('custom toolbar buttons normalize copied records while preserving stable IDs', () => {
	assert.deepEqual(normalizeCustomToolbarButtons(), []);
	const button = { id: ' custom-split ', name: ' Split selection ', icon: ' CUT ', actionId: ' split ' };
	const input = [button];
	const normalized = normalizeCustomToolbarButtons(input);
	assert.deepEqual(normalized, [BUTTON]);
	assert.equal(button.name, ' Split selection ');
	assert.deepEqual(normalizeCustomToolbarButtons(normalized), [BUTTON]);
});

test('custom toolbar buttons accept every registered font symbol and preserve action IDs', () => {
	const buttons = Object.keys(MUSESCORE_ICON_CODES).map((icon) => ({
		...BUTTON, id: `custom-${icon}`, icon, actionId: 'action://editor/selection-action',
	}));
	assert.deepEqual(normalizeCustomToolbarButtons(buttons), buttons);
});

test('custom toolbar buttons reject malformed records, unsupported symbols and duplicate IDs', () => {
	for (const value of [null, false, '', {}, 1]) {
		assert.throws(() => normalizeCustomToolbarButtons(value), TypeError);
	}
	for (const value of [null, false, [], 'button']) {
		assert.throws(() => normalizeCustomToolbarButtons([value]), TypeError);
	}
	for (const field of ['id', 'name', 'icon', 'actionId']) {
		for (const value of [undefined, null, false, 1, '', '  ']) {
			assert.throws(() => normalizeCustomToolbarButtons([{ ...BUTTON, [field]: value }]), TypeError);
		}
	}
	for (const icon of ['NOT_AN_ICON', '__proto__', 'toString']) {
		assert.throws(() => normalizeCustomToolbarButtons([{ ...BUTTON, icon }]), RangeError);
	}
	assert.throws(() => normalizeCustomToolbarButtons([BUTTON, { ...BUTTON, id: ' custom-split ' }]), RangeError);
	assert.equal(normalizeCustomToolbarButtons([BUTTON, { ...BUTTON, id: 'custom-split-2' }]).length, 2);
});

test('older preferences default to no custom buttons, and configured buttons survive persistence', () => {
	const defaults = createAudioEditorPreferencesV1();
	assert.deepEqual(defaults.workspace.customButtons, []);
	const oldWorkspace: Record<string, unknown> = { ...defaults.workspace };
	delete oldWorkspace.customButtons;
	const oldPreferences = { ...defaults, workspace: oldWorkspace };
	assert.deepEqual(loadAudioEditorPreferencesV1(oldPreferences).preferences.workspace.customButtons, []);
	const preferences = updateAudioEditorPreferencesV1(defaults, { workspace: { customButtons: [BUTTON] } });
	assert.deepEqual(preferences.workspace.customButtons, [BUTTON]);
	assert.deepEqual(defaults.workspace.customButtons, []);
	assert.deepEqual(preferences.workspace.toolbars, defaults.workspace.toolbars);
	assert.equal(validateAudioEditorPreferencesV1(preferences), true);
	const restored = loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(preferences)) as unknown);
	assert.equal(restored.readOnly, false);
	assert.deepEqual(restored.preferences.workspace.customButtons, [BUTTON]);
	const untrimmed = { ...preferences, workspace: {
		...preferences.workspace, customButtons: [{ ...BUTTON, id: ' custom-split ', name: ' Split selection ' }],
	} };
	assert.deepEqual(loadAudioEditorPreferencesV1(untrimmed).preferences.workspace.customButtons, [BUTTON]);
	assert.throws(() => createAudioEditorPreferencesV1({ workspace: { customButtons: [{ ...BUTTON, icon: 'missing' }] } }), RangeError);
	assert.throws(() => validateAudioEditorPreferencesV1({ ...defaults, workspace: { ...defaults.workspace, customButtons: [BUTTON, BUTTON] } }), RangeError);
});

test('custom buttons belong to the user across built-in and saved workspace changes', () => {
	const preferences = createAudioEditorPreferencesV1({ workspace: { customButtons: [BUTTON] } });
	const classic = applyAudioEditorWorkspace(preferences, 'classic');
	assert.deepEqual(classic.workspace.customButtons, [BUTTON]);
	const custom = createCustomAudioEditorWorkspace(classic, { id: 'editing', name: 'Editing' });
	assert.deepEqual(custom.workspace.customButtons, [BUTTON]);
	const modern = applyAudioEditorWorkspace(custom, 'modern');
	assert.deepEqual(modern.workspace.customButtons, [BUTTON]);
	const editing = applyAudioEditorWorkspace(modern, 'editing');
	assert.deepEqual(editing.workspace.customButtons, [BUTTON]);
	const deleted = deleteCustomAudioEditorWorkspace(editing, 'editing');
	assert.deepEqual(deleted.workspace.customButtons, [BUTTON]);
	const cleared = updateAudioEditorPreferencesV1(deleted, { workspace: { customButtons: [] } });
	assert.deepEqual(cleared.workspace.customButtons, []);
});
