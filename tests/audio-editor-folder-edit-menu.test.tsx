/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createFolderEditMenu } from '../src/common/editor/ui/folder-edit-menu.ts';
import { collectAudacityShortcutCommands } from '../src/common/editor/ui/dialogs/workspace-preferences-shortcut-commands.ts';
import { resolveAudioEditorShortcutHandler } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { AUDIO_EDITOR_DEFAULT_SHORTCUTS } from '../src/common/editor/preferences.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { FolderContentOverview } from '../src/common/editor/ui/timeline/FolderContentOverview.tsx';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { folderEditProject } from './helpers/folder-edit-project.ts';
import { FRAMESCAPER_PROFILE } from '../src/common/product-profiles.js';

test('all six folder commands are menu reachable and assignable without default shortcuts', () => {
	const project = resolveRuntimeProjectProjection(folderEditProject().project);
	const invoked: string[] = [];
	const menu = createFolderEditMenu({ project, folderId: 'dialogue', copy: ENGLISH_COPY, blocked: false, hasClipboard: true }, id => invoked.push(id));
	const inventory = collectAudacityShortcutCommands([menu]);
	for (const item of menu.items) {
		assert.deepEqual(AUDIO_EDITOR_DEFAULT_SHORTCUTS[item.id] ?? [], []);
		assert.ok(inventory.some(command => command.id === item.id && !command.disabled));
		const handler = resolveAudioEditorShortcutHandler(item.id, { menus: [menu] });
		if (item.disabled) assert.equal(handler, null);
		else { assert.ok(handler); handler(); }
	}
	assert.deepEqual(invoked, ['folder-select', 'folder-split', 'folder-ripple-insert']);
	const framescaperCommands = collectAudacityShortcutCommands([], { disabledCommandIds: FRAMESCAPER_PROFILE.shortcuts.disabledCommandIds });
	assert.ok(framescaperCommands.every(command => !command.id.startsWith('folder-')));
});

test('folder command menu disables range edits without a range and mutation of locked descendants', () => {
	const project = resolveRuntimeProjectProjection(folderEditProject().project);
	const menu = createFolderEditMenu({ project: { ...project, selection: { startFrame: 12_000, endFrame: 36_000 },
		tracks: project.tracks.map(track => ({ ...track, locked: track.id === 'ambience' })) }, folderId: 'dialogue', copy: ENGLISH_COPY, blocked: false, hasClipboard: true }, () => undefined);
	assert.equal(menu.items[0]?.disabled, false);
	assert.ok(menu.items.slice(1).every(item => item.disabled));
});

test('the folder overview becomes interactive only after its descendant tracks are explicitly selected', () => {
	const project = resolveRuntimeProjectProjection(folderEditProject().project);
	const props = { project, folderId: 'dialogue', name: 'Dialogue', copy: ENGLISH_COPY,
		controller: { actions: { timeline: { snapFrame: (frame: number) => frame, setExactSelection: () => undefined }, transport: { seek: () => undefined } } },
		pixelsPerSecond: 100, sampleRate: 48_000, renderOriginX: 0, run: (operation: () => unknown) => operation() };
	const passive = renderToStaticMarkup(<FolderContentOverview {...props} />);
	assert.doesNotMatch(passive, /role="group"/u);
	const active = renderToStaticMarkup(<FolderContentOverview {...props} selection={{ startFrame: 0, endFrame: 48_000, trackIds: ['voice', 'ambience'] }} />);
	assert.match(active, /aria-label="Contents of Dialogue"/u);
	assert.match(active, /audio-editor-folder-content-selection/u);
});
