/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MotionscaperLocaleSettings, dispatchMotionscaperLocale } from '../desktop/motionscaper-locale.ts';
import { COMMITTED_LOCALE_TAGS } from '../src/common/i18n/locales.js';
import { resolveMotionDesktopLocale, validateMotionDesktopLocale } from '../src/motionscaper/desktop-locale-contract.ts';

const caller = { ownWindow: true, mainFrame: true, url: 'motionscaper-app://bundle/' };
test('Motion locale matching skips malformed candidates and uses exact, language, then English fallback', () => {
	assert.equal(resolveMotionDesktopLocale(['invalid_!', 'de-DE']), 'de');
	assert.equal(resolveMotionDesktopLocale(['pt_BR']), 'pt-BR');
	assert.equal(resolveMotionDesktopLocale(['fr-CA', 'de']), 'fr');
	assert.equal(resolveMotionDesktopLocale(['zz-ZZ']), 'en');
	for (const locale of COMMITTED_LOCALE_TAGS) assert.equal(validateMotionDesktopLocale(locale), locale);
	for (const value of [null, {}, [], '', 'zz', '../de', 'de'.repeat(40)]) assert.throws(() => validateMotionDesktopLocale(value));
});

test('Motion locale selection persists and wins over a later system preference without foreign settings', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-locale-')); context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'settings.json'), settings = new MotionscaperLocaleSettings(path);
	assert.equal(await settings.load(['de-DE']), 'de');
	assert.equal(await settings.set('ja'), 'ja');
	assert.deepEqual(JSON.parse(await readFile(path, 'utf8')) as unknown, { schemaVersion: 1, locale: 'ja' });
	assert.equal(await new MotionscaperLocaleSettings(path).load(['en-US']), 'ja');
});

test('Motion locale writes serialize and failed persistence leaves the authoritative language unchanged', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-locale-failure-')); context.after(() => rm(root, { recursive: true, force: true }));
	const directory = join(root, 'state'), settings = new MotionscaperLocaleSettings(join(directory, 'settings.json'));
	await settings.load(['en']); await Promise.all([settings.set('fr'), settings.set('de')]);
	assert.equal(settings.locale, 'de');
	await rm(directory, { recursive: true }); await writeFile(directory, 'not a directory');
	await assert.rejects(settings.set('ja')); assert.equal(settings.locale, 'de');
});

test('Motion locale IPC refuses foreign callers and nonclosed requests before touching persistence', async () => {
	const calls: string[] = []; const set = async (locale: string) => { calls.push(locale); return locale; };
	for (const bad of [{ ...caller, ownWindow: false }, { ...caller, mainFrame: false }, { ...caller, url: 'https://motionscaper.org/' }]) {
		await assert.rejects(dispatchMotionscaperLocale(bad, { locale: 'de' }, set));
	}
	for (const request of [null, [], {}, { locale: 'de', reload: true }, { locale: 'zz' }, { locale: 7 }]) {
		await assert.rejects(dispatchMotionscaperLocale(caller, request, set));
	}
	assert.deepEqual(calls, []);
	assert.equal(await dispatchMotionscaperLocale(caller, { locale: 'de' }, set), 'de'); assert.deepEqual(calls, ['de']);
});
