/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ReleaseChecker, selectUpdate } from '../desktop/update-check.ts';
import { compareVersions } from '../desktop/release-version.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

test('date-based RC updates follow calendar months in both directions', () => {
	for (let index = 1; index < MONTHS.length; index += 1) {
		const earlier = `1.0.0-rc.${MONTHS[index - 1]}.28.z`;
		const later = `1.0.0-rc.${MONTHS[index]}.1.a`;
		assert.equal(compareVersions(later, earlier), 1, `${later} follows ${earlier}`);
		assert.equal(compareVersions(earlier, later), -1, `${earlier} precedes ${later}`);
	}
});

test('date-based RC updates order days and the release command letter sequence', () => {
	for (const [earlier, later] of [
		['1.0.0-rc.Nov.9.z', '1.0.0-rc.Nov.10.a'],
		['1.0.0-rc.Nov.9.a', '1.0.0-rc.Nov.9.b'],
		['1.0.0-rc.Nov.9.z', '1.0.0-rc.Nov.9.aa'],
		['1.0.0-rc.Nov.9.az', '1.0.0-rc.Nov.9.ba'],
		['1.0.0-rc.Nov.9.zz', '1.0.0-rc.Nov.9.aaa'],
	]) {
		assert.equal(compareVersions(later, earlier), 1);
		assert.equal(compareVersions(earlier, later), -1);
	}
	assert.equal(compareVersions('v1.0.0-rc.Nov.9.a+new', '1.0.0-rc.Nov.9.a+old'), 0);
});

test('date-based RC ordering preserves stable and ordinary semantic release precedence', () => {
	assert.equal(compareVersions('1.0.0', '1.0.0-rc.Dec.31.z'), 1);
	assert.equal(compareVersions('1.0.1-rc.Jan.1.a', '1.0.0-rc.Dec.31.z'), 1);
	assert.equal(compareVersions('1.0.0-rc.10', '1.0.0-rc.2'), 1);
	assert.equal(compareVersions('1.0.0-rc.Nov.9.a', '1.0.0-beta.99'), 1);
});

test('update selection chooses the latest calendar RC within each product tag namespace', () => {
	for (const prefix of ['soundscaper-v', 'framescaper-v']) {
		const releases = ['Oct.31.z', 'Nov.10.a', 'Nov.9.z', 'Nov.9.aa'].map(date => ({
			tag_name: `${prefix}1.0.0-rc.${date}`, prerelease: true, draft: false,
		}));
		releases.push({ tag_name: `${prefix}1.0.0-rc.Dec.1.a`, prerelease: true, draft: true });
		releases.push({ tag_name: 'other-v9.0.0', prerelease: false, draft: false });
		assert.equal(selectUpdate(releases, '1.0.0-rc.Nov.9.a', prefix)?.tag_name, `${prefix}1.0.0-rc.Nov.10.a`);
		assert.equal(selectUpdate(releases, '1.0.0-rc.Nov.10.a', prefix), null);
		assert.equal(selectUpdate(releases, '1.0.0', prefix), null);
	}
});

test('a November desktop build does not notify about an October RC', async () => {
	const checker = new ReleaseChecker({
		currentVersion: '1.0.0-rc.Nov.9.a', tagPrefix: 'soundscaper-v',
		settings: {
			snapshot: () => ({ updatesEnabled: true, lastUpdateCheck: null }),
			recordUpdateCheck: async () => {},
		},
		fetchImpl: async () => Response.json([
			{ tag_name: 'soundscaper-v1.0.0-rc.Oct.31.z', prerelease: true, draft: false },
		]),
	});
	assert.deepEqual(await checker.check(), { status: 'current' });
});
