/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MotionscaperLocaleSettings } from '../desktop/motionscaper-locale.ts';
import { prepareMotionQualificationLocale } from '../desktop/motionscaper-qualification-locale.ts';

test('Motion qualification persists English in its fresh profile despite non-English system preferences', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-qualification-locale-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const unseeded = new MotionscaperLocaleSettings(join(root, 'unseeded', 'locale-settings.json'));
	assert.equal(await unseeded.load(['de-DE', 'fr-FR']), 'de');
	for (const preferred of [['de-DE', 'fr-FR'], ['fr-FR', 'de-DE']]) {
		const directory = join(root, preferred[0]!); await mkdir(directory);
		const profile = await prepareMotionQualificationLocale(directory);
		assert.equal(profile, join(directory, 'profile'));
		const settingsPath = join(profile, 'locale-settings.json');
		assert.equal(await new MotionscaperLocaleSettings(settingsPath).load(preferred), 'en');
		assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')) as unknown, { schemaVersion: 1, locale: 'en' });
	}
});

test('Motion qualification refuses an existing profile without rewriting its locale or other state', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-qualification-borrowed-locale-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const profile = join(root, 'profile'), settingsPath = join(profile, 'locale-settings.json');
	await new MotionscaperLocaleSettings(settingsPath).set('fr');
	await writeFile(join(profile, 'session-state'), 'existing private state');
	const original = await readFile(settingsPath);
	await assert.rejects(prepareMotionQualificationLocale(root), { code: 'EEXIST' });
	assert.deepEqual(await readFile(settingsPath), original);
	assert.equal(await readFile(join(profile, 'session-state'), 'utf8'), 'existing private state');
	assert.deepEqual((await readdir(profile)).sort(), ['locale-settings.json', 'session-state']);
});

test('Motion qualification refuses a profile path already occupied by a file', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-qualification-locale-collision-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, 'profile'), 'existing file');
	await assert.rejects(prepareMotionQualificationLocale(root), { code: 'EEXIST' });
	assert.equal(await readFile(join(root, 'profile'), 'utf8'), 'existing file');
});
