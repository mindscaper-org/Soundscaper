/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionscaperDesktopEnvironment } from '../desktop/motionscaper-desktop-contract.ts';
import { createMotionscaperNativeMenu } from '../desktop/motionscaper-locale.ts';
import { resolveMotionscaperLocaleCopy } from '../src/common/i18n/editor-motionscaper-locale-copy.ts';
import { COMMITTED_LOCALE_TAGS } from '../src/common/i18n/locales.js';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
import { createMotionscaperShellMenus } from '../src/common/editor/ui/motionscaper/shell-menu.ts';

// A locale is an explicit startup input, separate from the optional native carrier.
const environment: (version: string, platform: string, nativeProres: boolean, locale: string) =>
	ReturnType<typeof motionscaperDesktopEnvironment> = motionscaperDesktopEnvironment;

test('Motion desktop advertises the selected committed startup locale without changing its native capabilities', () => {
	for (const locale of COMMITTED_LOCALE_TAGS) {
		const value = environment('0.1.0-alpha.1', 'linux', false, locale);
		assert.equal(value.locale, locale, `selected locale ${locale} must reach the renderer`);
		assert.deepEqual(value.nativeCapabilities, ['project-files-v1']);
	}
	assert.deepEqual(environment('0.1.0-alpha.1', 'win32', true, 'de').nativeCapabilities,
		['project-files-v1', 'prores-4444-v1']);
});

test('Motion desktop keeps English as its backward-compatible startup default', () => {
	assert.equal(motionscaperDesktopEnvironment('0.1.0-alpha.1', 'linux').locale, 'en');
});

test('Motion desktop language preference is menu-reached before a project exists and waits while busy', () => {
	let opened = 0;
	const options = { copy: motionscaperCopy('de'), workspaceOpen: false, hasProject: false,
		onToggleWorkspace: () => undefined, onLanguage: () => { opened++; } };
	const find = (busy: boolean) => createMotionscaperShellMenus({ ...options, busy })
		.find(menu => menu.id === 'view')?.items.find(item => item.id === 'motion-language');
	const idle = find(false);
	assert.ok(idle, 'the desktop locale preference must be reachable from View');
	assert.equal(idle.label, 'Sprache'); assert.equal(idle.disabled, false);
	idle.onClick?.(); assert.equal(opened, 1);
	assert.equal(find(true)?.disabled, true); assert.equal(find(true)?.onClick, undefined);
});

test('Motion browser menus do not advertise an unavailable native locale setter', () => {
	const menus = createMotionscaperShellMenus({ copy: motionscaperCopy('en'), workspaceOpen: false,
		onToggleWorkspace: () => undefined });
	assert.equal(menus.flatMap(menu => menu.items).some(item => item.id === 'motion-language'), false);
});


test('Motion native menu and chooser/error copy follow the selected language independently of the document URL', () => {
	assert.equal(createMotionscaperNativeMenu('de', 'linux'), null, 'Linux uses the localized in-document menu');
	assert.equal(createMotionscaperNativeMenu('en', 'win32'), null, 'Windows uses the localized in-document menu');
	const mac = createMotionscaperNativeMenu('de', 'darwin'); assert.ok(mac);
	assert.equal(mac[0]?.role, 'appMenu');
	assert.deepEqual(mac.slice(1).map(item => item.label), ['Datei', 'Bearbeiten', 'Ansicht', 'Fenster']);
	const copy = resolveMotionscaperLocaleCopy('de');
	assert.equal(copy.motionscaperNativeOpenTitle, 'Motionscaper-Projekt öffnen');
	assert.equal(copy.motionscaperNativeSaveTitle, 'Motionscaper-Projekt speichern');
	assert.equal(copy.motionscaperNativeLaunchErrorTitle, 'Motionscaper konnte das Projekt nicht öffnen');
	assert.equal(copy.motionscaperNativeStartupErrorTitle, 'Motionscaper konnte nicht starten');
});
