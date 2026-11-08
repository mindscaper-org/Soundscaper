/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { COMMITTED_LOCALE_TAGS } from '../../src/common/i18n/locales.js';
import { createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';

async function install(page: Page, initialLocale = 'en') {
	const archive = await exportMotionscaperArchive(createMotionscaperProject({ id: 'locale-native-project', title: 'Native original', compositionId: 'comp', width: 32, height: 32, durationFrames: 2 }), () => null);
	if (!archive) throw new Error('Archive missing.');
	await page.addInitScript(({ bytes, initialLocale }) => {
		let locale = initialLocale, cold = true, held = false, hold = false, fail = false;
		let release = () => undefined as void; const binds: string[] = [], requests: string[] = [];
		Object.defineProperty(globalThis, '__motionLocaleMarker', { value: crypto.randomUUID() });
		Object.defineProperty(globalThis, '__motionLocaleState', { value: () => ({ locale, binds, requests }) });
		Object.defineProperty(globalThis, '__motionLocaleHold', { value: (value: boolean) => { hold = value; } });
		Object.defineProperty(globalThis, '__motionLocaleRelease', { value: () => release() });
		Object.defineProperty(globalThis, '__motionLocaleFail', { value: () => { fail = true; } });
		Object.defineProperty(globalThis, 'scapeDesktop', { value: { v1: {
			getEnvironment: async () => ({ locale }), motionLocale: { set: async (next: string) => {
				requests.push(next); if (hold) await new Promise<void>(resolve => { release = resolve; });
				if (fail) { fail = false; throw new Error('Preference persistence failed.'); } locale = next; return locale;
			} }, motionFiles: {
				selectOpen: async () => null, read: async ({ offset, length }: { offset: number; length: number }) => { if (!held) throw new Error('Read after release.'); return new Uint8Array(bytes.slice(offset, offset + length)); },
				release: async () => { held = false; }, bindOpened: async ({ projectId }: { projectId: string }) => { binds.push(projectId); },
				beginSave: async () => null, write: async () => undefined, commit: async () => { throw new Error('Not a save.'); }, cancel: async () => undefined,
			}, motionLaunch: {
				take: async () => { if (!cold) return null; cold = false; held = true; return { token: 'native-locale', name: 'native.mscape', byteLength: bytes.length }; },
				acknowledge: async () => { if (held) throw new Error('Acknowledged before release.'); }, onPending: () => () => undefined,
			},
		} } });
	}, { bytes: Array.from(new Uint8Array(await archive.arrayBuffer())), initialLocale });
}
async function menu(page: Page, top: string, item: string) {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click();
}
async function state(page: Page) { return await page.evaluate(() => (Reflect.get(globalThis, '__motionLocaleState') as () => { locale: string; binds: string[]; requests: string[] })()); }

test('Motion desktop starts in its persisted German locale even when the document path is English', async ({ page }) => {
	await install(page, 'de'); await page.goto('/embed/en/');
	await expect(page.getByRole('menuitem', { name: 'Datei', exact: true })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Native original');
});

test('Motion language preference changes copy in place after persistence and preserves dirty history and native binding', async ({ page }) => {
	await install(page); await page.goto('/embed/en/');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Native original');
	await expect.poll(async () => (await state(page)).binds).toEqual(['locale-native-project']);
	const marker: unknown = await page.evaluate(() => Reflect.get(globalThis, '__motionLocaleMarker'));
	await menu(page, 'View', 'Composition Settings');
	const settings = page.getByRole('dialog', { name: 'Composition Settings', exact: true });
	await settings.getByLabel('Project title', { exact: true }).fill('Unpublished locale draft');
	await settings.getByRole('button', { name: 'Apply', exact: true }).click();
	await menu(page, 'View', 'Language'); const language = page.getByRole('dialog', { name: 'Language', exact: true });
	await expect(language).toBeVisible();
	expect(await language.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(COMMITTED_LOCALE_TAGS);
	await language.getByLabel('Language', { exact: true }).selectOption('de');
	await page.evaluate(() => { (Reflect.get(globalThis, '__motionLocaleHold') as (hold: boolean) => void)(true); });
	await language.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect.poll(async () => (await state(page)).requests).toEqual(['de']);
	await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Unpublished locale draft');
	await page.evaluate(() => { (Reflect.get(globalThis, '__motionLocaleHold') as (hold: boolean) => void)(false); (Reflect.get(globalThis, '__motionLocaleRelease') as () => void)(); });
	await expect(language).toBeHidden(); await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	await expect(page.getByRole('menuitem', { name: 'Datei', exact: true })).toBeVisible();
	await menu(page, 'Bearbeiten', 'Rückgängig'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Native original');
	await menu(page, 'Bearbeiten', 'Wiederholen'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Unpublished locale draft');
	await menu(page, 'Ansicht', 'Sprache'); const german = page.getByRole('dialog', { name: 'Sprache', exact: true });
	await german.getByLabel('Sprache', { exact: true }).selectOption('ar');
	await page.evaluate(() => { (Reflect.get(globalThis, '__motionLocaleFail') as () => void)(); });
	await german.getByRole('button', { name: 'Anwenden', exact: true }).click();
	await expect(german.getByRole('alert')).toContainText('Die Spracheinstellung konnte nicht gespeichert werden.');
	await expect(page.locator('html')).toHaveAttribute('lang', 'de'); await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Unpublished locale draft');
	await german.getByRole('button', { name: 'Anwenden', exact: true }).click();
	await expect(german).toBeHidden(); await expect(page.locator('html')).toHaveAttribute('lang', 'ar'); await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Unpublished locale draft');
	expect((await state(page)).binds).toEqual(['locale-native-project']);
	expect(await page.evaluate(() => Reflect.get(globalThis, '__motionLocaleMarker'))).toBe(marker);
});
