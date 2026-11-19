/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { AUDACITY_ACTION_MANIFEST, resolveAudacityActionId } from '../src/common/editor/audacity-action-parity.js';
import { DEFAULT_PANELS } from '../src/common/editor/workspace-layout-defaults.ts';
import { normalizePanelEntries } from '../src/common/editor/workspace-preference-normalization.js';
import { WORKSPACE_PANEL_IDS, workspacePanelLabel } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

test('Macro manager edits macros and Macros palette opens a separate workspace panel', () => {
	assert.equal(ENGLISH_COPY.macrosPalette, 'Macros palette');
	assert.equal(ENGLISH_COPY.macroManager, 'Macro manager');
	assert.equal(AUDACITY_ACTION_MANIFEST['manage-macros']?.label, 'Macro manager');
	assert.equal(AUDACITY_ACTION_MANIFEST['manage-macros']?.handler, 'macros.openManager');
	assert.equal(AUDACITY_ACTION_MANIFEST['macros-palette']?.handler, 'macros.openPalette');
	assert.equal(resolveAudacityActionId('macro-manager'), 'manage-macros');
	assert.equal(resolveAudacityActionId('macros-palette'), 'macros-palette');
	assert.ok(WORKSPACE_PANEL_IDS.includes('macros-palette'));
	assert.equal(workspacePanelLabel(ENGLISH_COPY, 'macros-palette'), 'Macros palette');
});

test('the palette stays opt-in and restores its saved panel placement', () => {
	assert.equal(DEFAULT_PANELS['macros-palette'].visible, false);
	assert.equal(normalizePanelEntries({})['macros-palette'].visible, false);
	const restored = normalizePanelEntries({ 'macros-palette': { visible: true, dock: 'floating', x: 91, y: 42 } });
	assert.equal(restored['macros-palette'].visible, true);
	assert.equal(restored['macros-palette'].dock, 'floating');
	assert.equal(restored['macros-palette'].x, 91);
	assert.equal(restored['macros-palette'].y, 42);
});
