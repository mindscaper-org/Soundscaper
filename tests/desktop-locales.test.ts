/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SUPPORTED_LOCALES } from '../desktop/constants.js';
import { DesktopSettingsStore } from '../desktop/settings.js';
import { resolveLocale, validateLocale } from '../desktop/validation.js';
import { AUDACITY_LOCALE_SUPERSET, ROUTE_LOCALES } from '../src/common/i18n/locales.js';

type LocaleDescriptor = { readonly locale: string };
const menuLocales: readonly LocaleDescriptor[] = ROUTE_LOCALES;
const knownLocales: readonly LocaleDescriptor[] = AUDACITY_LOCALE_SUPERSET;

test('desktop locale admission matches every language offered in General preferences', () => {
	assert.deepEqual(SUPPORTED_LOCALES, menuLocales.map(({ locale }) => locale));
});

for (const { locale } of menuLocales) {
	test(`desktop accepts, persists and restores the ${locale} menu locale`, async (context) => {
		assert.equal(validateLocale(locale), locale);
		assert.equal(validateLocale(locale.toUpperCase()), locale);
		assert.equal(resolveLocale([locale, 'en']), locale);

		const root = await mkdtemp(join(tmpdir(), 'soundscaper-locale-'));
		context.after(() => rm(root, { recursive: true, force: true }));
		const filePath = join(root, 'settings.json');
		const settings = new DesktopSettingsStore(filePath);
		await settings.load(['en']);
		assert.equal(await settings.setLocale(locale), locale);
		assert.equal(settings.snapshot().locale, locale);

		const restored = new DesktopSettingsStore(filePath);
		assert.equal((await restored.load([locale === 'en' ? 'de' : 'en'])).locale, locale,
			'the saved language takes precedence over the OS language after restart');
	});
}

test('desktop OS locale selection resolves newly supported regional preferences', () => {
	assert.equal(resolveLocale(['cs-CZ', 'de']), 'cs');
	assert.equal(resolveLocale(['it-IT', 'en']), 'it');
	assert.equal(resolveLocale(['pt_PT', 'pt-BR']), 'pt-PT');
	assert.equal(resolveLocale(['zh-TW', 'zh-CN']), 'zh-TW');
});

test('desktop rejects languages without a committed editor route', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-locale-invalid-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const filePath = join(root, 'settings.json');
	const settings = new DesktopSettingsStore(filePath);
	await settings.load(['de']);
	const uncommitted = knownLocales
		.filter(({ locale }) => !menuLocales.some((route) => route.locale === locale))
		.map(({ locale }) => locale);
	for (const value of [...uncommitted, '', 'unknown-locale', 'fr-CA', '../fr', null, undefined]) {
		assert.throws(() => validateLocale(value), /Unsupported locale/u);
		await assert.rejects(() => settings.setLocale(value), /Unsupported locale/u);
	}
	assert.equal(settings.snapshot().locale, 'de');
	assert.equal((await new DesktopSettingsStore(filePath).load(['en'])).locale, 'de');
});
