/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { nativeGrantedFilesystemFixtureCurrentV1 as fixture, grantedFsPathCurrentV1 as path,
	grantedFsComponentKeyCurrentV1 as key, GRANTED_FS_OP as op } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';
const deadline = { timeout: 15000 };

void test('held native scan is lazy, bounded and independent of the textual directory path', deadline, async context => fixture(context, async f => {
	const expected = new Set([key(path('photo.bin')), key(path('nested'))]);
	for (let index = 0; index < 130; index++) {
		const name = `entry-${String(index).padStart(3, '0')}`; await writeFile(join(f.rootPath, name), f.bytes); expected.add(key(path(name)));
	}
	const root = await f.root(), scan = await root.openScan([]), retained = join(f.directory, 'retained');
	await rename(f.rootPath, retained); await symlink(f.outside, f.rootPath, process.platform === 'win32' ? 'junction' : 'dir');
	await writeFile(join(retained, 'created-after-scan-open'), f.bytes); expected.add(key(path('created-after-scan-open')));
	const observed = new Set<string>(); let pages = 0;
	for (;;) {
		const page = await scan.next(); pages++; assert.ok(page.entries.length <= 64);
		for (const entry of page.entries) {
			const name = key(entry.component); assert.equal(observed.has(name), false); observed.add(name);
			assert.ok(['file', 'directory', 'link', 'other', 'unknown'].includes(entry.kind));
			assert.ok(entry.observation === null || entry.observation.byteLength === 16);
		}
		if (page.done) break; assert.ok(page.entries.length > 0); assert.ok(pages < 10);
	}
	assert.ok(pages >= 3); assert.equal([...observed].sort().join('\n'), [...expected].sort().join('\n'));
	const done = await scan.next(); assert.equal(done.done, true); assert.equal(done.entries.length, 0);
	assert.equal(f.count(op.read), 0, 'directory observations are not body reads');
	assert.ok(f.native.maximumResponse(op.next) <= 65536);
	await scan.close(); await root.close();
}));

void test('directory scan emits native raw names and symlink hints without following them', deadline, async context => fixture(context, async f => {
	const root = await f.root();
	const name = process.platform === 'win32' ? 'unpaired-\ud800.bin' : Buffer.from([97, 108, 105, 97, 115, 45, 255]);
	if (typeof name === 'string') {
		// Node encodes JS paths before native IO; actual loneUTF16 creation is
		// covered by the qualified C++ primitive fixture, not faked here.
		await writeFile(join(f.rootPath, 'unpaired-\ufffd.bin'), f.bytes);
	} else await writeFile(Buffer.concat([Buffer.from(`${f.rootPath}/`), name]), f.bytes);
	await symlink(f.outside, join(f.rootPath, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
	const scan = await root.openScan([]); const entries = [];
	for (;;) { const page = await scan.next(); entries.push(...page.entries); if (page.done) break; assert.ok(entries.length < 64); }
	const expected = key(path(typeof name === 'string' ? 'unpaired-\ufffd.bin' : name));
	assert.ok(entries.some(entry => key(entry.component) === expected));
	const link = entries.find(entry => key(entry.component) === key(path('outside-link'))); assert.equal(link?.kind, 'link');
	assert.equal(f.count(op.read), 0); await assert.rejects(root.openScan([path('outside-link')]));
	await scan.close(); await root.close();
}));

void test('scan pages own detached name snapshots and keep closed cursor admission fenced', deadline, async context => fixture(context, async f => {
	const root = await f.root(), scan = await root.openScan([]), first = await scan.next();
	assert.ok(first.entries.length); const before = key(first.entries[0]!.component);
	first.entries[0]!.component.bytes.fill(0); await scan.close();
	const again = await root.openScan([]), page = await again.next();
	assert.ok(page.entries.some(entry => key(entry.component) === before));
	await assert.rejects(scan.next()); await again.close(); await root.close();
}));
