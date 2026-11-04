/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_EDITOR_DEFAULT_SHORTCUTS, normalizeAudioEditorShortcut } from '../src/common/editor/preferences.js';
import { AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION, migrateAudioEditorShortcutDefaults } from '../src/common/editor/shortcut-default-migration.ts';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { pagedTimelineScroll } from '../src/common/editor/ui/workspace/timeline-navigation-geometry.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const actionIds = ['timeline-page-left', 'timeline-page-right'] as const;

test('PageUp and PageDown dispatch timeline paging through the configurable command registry', () => {
	const performed: string[] = [];
	for (const [index, key] of ['PageUp', 'PageDown'].entries()) {
		let prevented = false;
		const actionId = actionIds[index]!;
		assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS[actionId], [key]);
		handleWorkspaceKeyboard({ key, code: key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
			target: null, defaultPrevented: false, preventDefault() { prevented = true; } },
		{ preferences: { shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS } }, work => work(),
		{ menus: actionIds.map(id => ({ id, onClick: () => { performed.push(id); } })) });
		assert.equal(prevented, true, 'paging must prevent the browser default scroll');
	}
	assert.deepEqual(performed, actionIds);
});

test('version five preferences gain paging defaults without taking customized or explicitly removed keys', () => {
	const options = { currentDefaults: AUDIO_EDITOR_DEFAULT_SHORTCUTS, formerDefaults: {}, shortcutDefaultsVersion: 5,
		normalizedKey: (binding: string) => normalizeAudioEditorShortcut(binding).toLowerCase() };
	const upgraded = migrateAudioEditorShortcutDefaults({ ...options, shortcuts: {} });
	assert.deepEqual(upgraded, { 'timeline-page-left': ['PageUp'], 'timeline-page-right': ['PageDown'] });
	const customized = { 'custom-action': ['PageDown'], 'timeline-page-left': [] };
	assert.deepEqual(migrateAudioEditorShortcutDefaults({ ...options, shortcuts: customized }), customized);
	assert.deepEqual(migrateAudioEditorShortcutDefaults({ ...options, shortcutDefaultsVersion: AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
		shortcuts: { 'timeline-page-left': [] } }), { 'timeline-page-left': [] });
});

test('timeline paging moves one viewport and clamps at both project boundaries', () => {
	const scroll = { scrollLeft: 400, scrollWidth: 3000, clientWidth: 800 };
	assert.equal(pagedTimelineScroll(scroll, 1), 1200);
	assert.equal(pagedTimelineScroll(scroll, -1), 0);
	assert.equal(pagedTimelineScroll({ ...scroll, scrollLeft: 2000 }, 1), 2200);
	assert.equal(pagedTimelineScroll({ ...scroll, scrollWidth: 800 }, 1), 0);
});

test('paging at deep zoom advances one visible content page instead of one browser scroll page', () => {
	const scroll = { scrollLeft: 400, scrollWidth: 3000, clientWidth: 800, dataset: { timelineScrollScale: '100' } };
	assert.equal(pagedTimelineScroll(scroll, 1), 408);
	assert.equal(pagedTimelineScroll(scroll, -1), 392);
});

test('paging shortcuts leave native input and menu navigation with the focused control', () => {
	const dom = installReactTestDom();
	try {
		for (const tag of ['input', 'textarea', 'select', 'menu']) {
			const target = dom.container.ownerDocument.createElement(tag === 'menu' ? 'div' : tag);
			if (tag === 'menu') target.setAttribute('role', 'menu');
			for (const key of ['PageUp', 'PageDown']) {
				let handled = false;
				handleWorkspaceKeyboard({ key, code: key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
					target: target as unknown as HTMLElement, defaultPrevented: false, preventDefault() { handled = true; } },
				{ preferences: { shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS } }, work => work(),
				{ menus: actionIds.map(id => ({ id, onClick: () => { handled = true; } })) });
				assert.equal(handled, false, `${tag}: ${key}`);
			}
		}
	} finally { dom.restore(); }
});
