/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exposeWebDesktopCommands } from '../src/common/editor/ui/web-desktop-command-menus.ts';
import { ASSISTANCE_TASKS, type AssistanceMenuEntry } from '../src/common/editor/ui/assistance-task-catalog.ts';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { findMenuItem } from './helpers/application-menu-fixture.ts';
import type { NativePreferenceEntry } from '../src/common/editor/ui/local-processing-menus.ts';

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
		const preferences = menus.flatMap(menu => menu.nativePreferences as readonly NativePreferenceEntry[] ?? []);
		for (const id of ids) {
			const item = findMenuItem([...menus, ...preferences], id);
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

for (const productId of ['soundscaper', 'framescaper']) {
	test(`${productId} web helper controls live only in their Preferences sections`, () => {
		const existing: NativePreferenceEntry = { id: 'parallel-stack-processing', section: 'advanced' };
		const options = { productId, locale: 'en', copy: EDITOR_ENGLISH_COPY, onUnavailable: () => undefined };
		const menus = exposeWebDesktopCommands([{ id: 'tools', nativePreferences: [existing] }], options);
		const tools = findMenuItem(menus, 'tools');
		const preferences = tools?.nativePreferences as readonly NativePreferenceEntry[];
		assert.deepEqual(preferences.map(({ id, section }) => [id, section]), [
			['parallel-stack-processing', 'advanced'],
			...(productId === 'framescaper' ? [['framescaper-native-media-preferences', 'media']] : []),
			['desktop-use-native-probe-helper', 'media'],
			['desktop-clear-probe-helper-quarantine', 'media'],
			['desktop-clear-audio-helper-quarantine', 'audio'],
			['desktop-discover-native-effects', 'effects'],
		]);
		assert.equal(preferences[0], existing);
		for (const entry of preferences) {
			assert.ok(entry.id);
			assert.equal(findMenuItem(menus, entry.id), null, entry.id);
		}
		assert.deepEqual(exposeWebDesktopCommands(menus, options), menus, 'rebuilding preserves each preference once');
	});
}

test('web Desktop services contains Blender sync and a named MCP download offer', () => {
	let prompts = 0;
	const menus = exposeWebDesktopCommands([], {
		productId: 'soundscaper', locale: 'en', copy: { ...EDITOR_ENGLISH_COPY, 'ui.desktopMcp.connection': undefined },
		onUnavailable: () => { prompts++; },
	});
	const tools = findMenuItem(menus, 'tools');
	const services = findMenuItem(tools?.items ?? [], 'desktop-services');
	assert.deepEqual(services?.items?.map(({ id }) => id), [
		'blender-start-live-sync', 'blender-stop-live-sync', 'desktop-mcp-connection',
	]);
	assert.equal(tools?.items?.some(({ id }) => id?.startsWith('blender-')), false);
	const mcp = findMenuItem(menus, 'desktop-mcp-connection');
	assert.equal(mcp?.label, 'MCP connection');
	mcp?.onClick?.();
	assert.equal(prompts, 1);
	const localized = exposeWebDesktopCommands([], {
		productId: 'soundscaper', locale: 'de', copy: { ...EDITOR_ENGLISH_COPY, 'ui.desktopMcp.connection': 'MCP-Verbindung' },
		onUnavailable: () => undefined,
	});
	assert.equal(findMenuItem(localized, 'desktop-mcp-connection')?.label, 'MCP-Verbindung');
});

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
