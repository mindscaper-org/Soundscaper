/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FRAMESCAPER_PROFILE, LIGHTSCAPER_PROFILE, SOUNDSCAPER_PROFILE } from '../src/common/product-profiles.js';

test('baseline editor sessions use fresh stable product partitions', async () => {
	const profiles = [SOUNDSCAPER_PROFILE, FRAMESCAPER_PROFILE, LIGHTSCAPER_PROFILE];
	assert.deepEqual(profiles.map(profile => profile.desktop.sessionPartition), [
		'persist:soundscaper-production', 'persist:framescaper-production', 'persist:lightscaper-production',
	]);
	assert.equal(new Set(profiles.map(profile => profile.desktop.sessionPartition)).size, 3);
	for (const profile of profiles) {
		const actual = spawnSync(process.execPath, ['--input-type=module', '--eval',
			"import { SESSION_PARTITION } from './desktop/constants.js'; process.stdout.write(SESSION_PARTITION);",
		], { cwd: new URL('..', import.meta.url), env: { ...process.env, SCAPE_PRODUCT: profile.id }, encoding: 'utf8', timeout: 10_000 });
		assert.equal(actual.error, undefined); assert.equal(actual.signal, null);
		assert.equal(actual.status, 0, actual.stderr);
		assert.equal(actual.stdout, profile.desktop.sessionPartition, profile.id);
	}

	const constants = await readFile(new URL('../desktop/constants.js', import.meta.url), 'utf8');
	assert.doesNotMatch(constants, /persist:(?:soundscaper|framescaper|lightscaper)-v\d+/u);
});

test('project-coupled native state uses fresh baseline identities', async () => {
	const [main, nativeRegistration] = await Promise.all([
		readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../desktop/framescaper-native-services-registration.mjs', import.meta.url), 'utf8'),
	]);
	assert.match(main, /linked-video-locators-project-v1\.json/u);
	assert.doesNotMatch(main, /linked-video-locators-v1\.json/u);
	assert.match(nativeRegistration, /framescaper-native-services-v1\.sqlite/u);
	assert.doesNotMatch(nativeRegistration, /resolve\([^\n]*framescaper-native-services\.sqlite/u);
});
