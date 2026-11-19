/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativePhotoSettingsCurrentV1 as Owner } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { nativeSettingsFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-photo-settings-fixture-current.ts';

for (const scope of [null, '', 'selected:', 'selected:a\n', 'anchor\n', 'selected:A', 'selected:a\0', `selected:${'a'.repeat(129)}`]) {
	test(`Lightscaper native settings reject invalid scope ${JSON.stringify(scope)} before creating product files`, async () => {
		const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native settings admission ')));
		let accidental: Owner | undefined;
		try {
			await assert.rejects(async () => { accidental = await Owner.open({ appDataPath, scope: scope as string }); }, /scope/u);
			assert.deepEqual(await readdir(appDataPath), []);
		} finally { await accidental?.close(); await rm(appDataPath, { recursive: true, force: true }); }
	});
}

test('Lightscaper native settings opening refuses accessor options without invoking them', async () => {
	let calls = 0;
	await assert.rejects(Owner.open({ get appDataPath() { calls += 1; return '/untrusted'; } }), /data property/u);
	assert.equal(calls, 0);
});

test('Lightscaper native settings admission calls have the existing undefined receiver and never await a returned thenable', async context => {
	const { settings: s } = await fixture(context), receivers: unknown[] = [], durable: boolean[] = [];
	await s.put('pointer', 0);
	const callback = function (this: unknown, value: boolean) {
		receivers.push(this); durable.push(value);
		return { get then(): never { throw new Error('Synchronous admission must not be awaited.'); } };
	};
	assert.equal(await s.replaceIfCurrentAndPutIfAbsent('pointer', 0, 1, 'history', 'published', callback), true);
	assert.deepEqual(receivers, [undefined, undefined]); assert.deepEqual(durable, [true, true]);
	assert.equal(await s.get('pointer'), 1); assert.equal(await s.get('history'), 'published');
});
