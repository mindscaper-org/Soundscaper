/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exposeWebDesktopCommands } from '../src/common/editor/ui/web-desktop-command-menus.ts';
import { ASSISTANCE_TASKS, type AssistanceMenuEntry } from '../src/common/editor/ui/assistance-task-catalog.ts';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { findMenuItem } from './helpers/application-menu-fixture.ts';

for (const productId of ['soundscaper', 'framescaper']) {
	test(`${productId} web menus expose desktop commands with monitor icons and safe activation`, () => {
		let prompts = 0;
		const menus = exposeWebDesktopCommands([], {
			productId, locale: 'en', copy: EDITOR_ENGLISH_COPY,
			onUnavailable: () => { prompts++; },
		});
		const ids = [
			'overwrite-original-file', 'ara-clip-editor', 'text-to-speech',
			'local-assistance', 'local-assistance-indexed-search', 'manage-local-models',
			'desktop-check-updates', 'desktop-view-source',
			'desktop-use-native-probe-helper', 'desktop-clear-probe-helper-quarantine',
			'desktop-clear-audio-helper-quarantine', 'desktop-discover-native-effects',
			...ASSISTANCE_TASKS.filter(task => !task.video || productId === 'framescaper')
				.map(task => `assistance-task-${task.workflowId}`),
			...(productId === 'soundscaper' ? [
				'native-effect-manage', 'native-effect-use', 'native-analyzer-use',
				'blender-export-tracks', 'blender-start-live-sync', 'blender-stop-live-sync',
				'desktop-mcp-connection',
			] : [
				'corridorkey-2.0', 'panel-web-vcr', 'framescaper-import-image-sequence', 'framescaper-add-to-render-queue',
				'framescaper-external-display', 'framescaper-background-jobs', 'framescaper-watch-folders',
				'framescaper-proxy-generate', 'framescaper-proxy-attach', 'framescaper-proxy-detach',
				'framescaper-proxy-relink', 'framescaper-ofx-manage', 'framescaper-ofx-add',
				'framescaper-ofx-interact', 'framescaper-native-media-preferences',
			]),
		];
		for (const id of ids) {
			const item = findMenuItem(menus, id);
			assert.ok(item, id);
			assert.equal(item.icon, '\uF35E', id);
			assert.equal(item.disabled, false, id);
			assert.equal(item.items, undefined, id);
			assert.equal(item.resolve, undefined, id);
			item.onClick?.();
		}
		assert.equal(prompts, ids.length);
		for (const id of productId === 'soundscaper'
			? ['corridorkey-2.0', 'framescaper-ofx-add', 'assistance-task-reframe']
			: ['native-effect-use', 'blender-export-tracks', 'desktop-mcp-connection']) {
			assert.equal(findMenuItem(menus, id), null, id);
		}
	});
}

test('web desktop offers preserve working commands and merge shared submenus without duplicates', () => {
	let workingCalls = 0;
	let nativeCalls = 0;
	const onUnavailable = () => undefined;
	const working = { id: 'working-effect', label: 'Working effect', onClick: () => { workingCalls++; } };
	const original: AssistanceMenuEntry[] = [{ id: 'effect', label: 'Effect', items: [
		{ id: 'framescaper-video-effects', label: 'Video effects', items: [working] },
		{ id: 'ara-clip-editor', disabled: true, resolve: () => ({ disabled: true }),
			onClick: () => { nativeCalls++; } },
	] }];
	const result = exposeWebDesktopCommands(original, {
		productId: 'framescaper', locale: 'en', copy: EDITOR_ENGLISH_COPY, onUnavailable,
	});
	assert.equal(findMenuItem(result, 'working-effect'), working);
	findMenuItem(result, 'working-effect')?.onClick?.();
	findMenuItem(result, 'ara-clip-editor')?.onClick?.();
	assert.equal(workingCalls, 1);
	assert.equal(nativeCalls, 0);
	assert.equal(findMenuItem(result, 'effect')?.items?.filter(item => item.id === 'framescaper-video-effects').length, 1);
	assert.equal(findMenuItem(original, 'ara-clip-editor')?.disabled, true);
	const repeated = exposeWebDesktopCommands(result, {
		productId: 'framescaper', locale: 'en', copy: EDITOR_ENGLISH_COPY, onUnavailable,
	});
	assert.deepEqual(repeated, result);
});
