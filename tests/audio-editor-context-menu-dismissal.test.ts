/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const UI_ROOT = new URL('../src/common/editor/ui/', import.meta.url);

// A menu closes when a pointer goes down outside it, and ContextMenu arms that
// document listener from an effect keyed on `onClose`. Re-arming is deferred by
// a `setTimeout`, so every change of `onClose` opens a window in which no
// listener is attached at all. A caller that builds a new closure on each render
// reopens that window on each render, and a pointer landing in one leaves the
// menu on screen — which is how the Firefox suite caught the application menu
// staying open after a click on the track area.

test('every application ContextMenu is closed through a stable reference', async () => {
	const callers = [
		'AudioEditorMenuBar.jsx',
		'workspace/WorkspacePanelHeader.jsx',
		'toolbar/WorkspaceSwitcherControl.jsx',
		'inspector/EffectStackMenu.tsx',
		'inspector/EffectPresetBar.jsx',
	];

	for (const caller of callers) {
		const source = await readFile(new URL(caller, UI_ROOT), 'utf8');
		// Only ContextMenu's own onClose matters here. A dialog shell rebuilding its
		// close handler per render costs nothing, because nothing keys a listener on it.
		const handlers = [...source.matchAll(/<ContextMenu\b[^>]*?onClose=\{([^}]*)\}/gsu)]
			.map((match) => match[1].trim());
		assert.ok(handlers.length > 0, `${caller} must still pass onClose to its menus`);
		for (const handler of handlers) {
			assert.doesNotMatch(handler, /=>|\bfunction\b/u,
				`${caller} must pass onClose by reference; \`${handler}\` builds a new one every render`);
		}
	}
});

test('the application menu closes through a callback that never changes identity', async () => {
	const source = await readFile(new URL('AudioEditorMenuBar.jsx', UI_ROOT), 'utf8');

	assert.match(source, /const closeMenu = useCallback\(\([\s\S]*?\n\t\}, \[\]\);/u,
		'closeMenu must keep an empty dependency list, or its identity changes with the render');
	assert.match(source, /onClose=\{closeMenu\}/u);
});
