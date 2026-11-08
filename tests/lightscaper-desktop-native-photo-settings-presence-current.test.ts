/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { nativeSettingsFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-photo-settings-fixture-current.ts';

test('Lightscaper native settings physical absence guards preserve even an undecodable occupied row', async context => {
	const { settings: s, databasePath } = await fixture(context);
	await s.put('pointer', { generation: 0 });
	const control = new DatabaseSync(databasePath);
	try {
		// Fixed UTF16BE bytes for "intent", with deliberately invalid codec data.
		control.prepare("INSERT INTO native_photo_settings(scope,key,payload) VALUES('anchor',x'0069006e00740065006e0074',x'00')").run();
		assert.equal(await s.putIfAbsent('intent', { replacement: true }), false);
		const admissions: boolean[] = [];
		assert.equal(await s.replaceIfCurrentAndPutIfAbsent('pointer', { generation: 0 }, { generation: 1 },
			'intent', { published: true }, durable => { admissions.push(durable); }), false);
		assert.deepEqual(admissions, [true]);
		assert.deepEqual(await s.get('pointer'), { generation: 0 });
		assert.deepEqual(control.prepare("SELECT payload FROM native_photo_settings WHERE scope='anchor' AND key=x'0069006e00740065006e0074'").get()?.payload, new Uint8Array([0]));
		await assert.rejects(s.readEntry('intent'));
	} finally { control.close(); }
});

test('Lightscaper native settings undecodable CAS current refuses the complete mutation and can still be explicitly deleted', async context => {
	const { settings: s, databasePath } = await fixture(context);
	const control = new DatabaseSync(databasePath);
	try {
		control.prepare("INSERT INTO native_photo_settings(scope,key,payload) VALUES('anchor',x'006b',x'00')").run();
		await assert.rejects(s.replaceIfCurrentAndPutIfAbsent('k', {}, 'replacement', 'new', 'history'));
		assert.deepEqual(await s.readEntry('new'), { present: false });
		assert.equal(control.prepare('SELECT count(*) AS n FROM native_photo_settings').get()?.n, 1);
		await s.delete('k');
		assert.deepEqual(await s.readEntry('k'), { present: false });
	} finally { control.close(); }
});
