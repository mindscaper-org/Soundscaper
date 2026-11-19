/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { nativeGrantedReaderFixtureCurrentV1 as fixture, nativeGrantedPathHexCurrentV1 as pathHex,
	grantedReaderHashCurrentV1 as sha, GRANTED_READER_ERROR as error } from './helpers/lightscaper-native-granted-file-reader-fixture-current.ts';
const deadline = { timeout: 15000 };
const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';

void test('actual retained native root/file yields exact bounded Original bytes without writing the grant', deadline, async context => fixture(context, async f => {
	const expected = await f.capture(f.root); assert.ok(expected.volume.length && expected.object.length);
	await f.capture(f.root, expected); assert.match(await f.open(['photo.bin']), /^FILE /u);
	const first = await f.read(0, 7), rest = await f.read(7, f.bytes.length - 7);
	assert.equal(sha(Buffer.concat([first, rest])), sha(f.bytes));
	assert.equal(await f.request('FILE_CLOSE'), 'CLOSED'); assert.equal(await f.request('FILE_CLOSE'), 'CLOSED');
	assert.equal((await f.request('READ 0 1')), `ERROR ${String(error.closed)}`);
	assert.equal(JSON.stringify((await readdir(f.root)).sort()), JSON.stringify(['nested', 'photo.bin']));
}));

void test('expected physical root identity refuses a substituted actual directory', deadline, async context => fixture(context, async f => {
	const expected = await f.capture(f.root), substitute = join(f.directory, 'substitute'); await mkdir(substitute);
	const line = await f.request(`ROOT ${pathHex(substitute)} ${Buffer.from(expected.volume).toString('hex')} ${Buffer.from(expected.object).toString('hex')}`);
	assert.equal(line, `ERROR ${String(error.rootIdentity)}`);
}));

void test('the root itself may not be a symlink or Windows junction even with the target expected identity', deadline, async context => fixture(context, async f => {
	const expected = await f.capture(f.root), alias = join(f.directory, 'root-alias'); await symlink(f.root, alias, directoryLink);
	const line = await f.request(`ROOT ${pathHex(alias)} ${Buffer.from(expected.volume).toString('hex')} ${Buffer.from(expected.object).toString('hex')}`);
	assert.equal(line, `ERROR ${String(error.link)}`);
}));

void test('a retained root cannot be redirected by replacing its textual parent path', deadline, async context => fixture(context, async f => {
	await f.capture(f.root); const retained = join(f.directory, 'retained-root'); await rename(f.root, retained);
	await symlink(f.outside, f.root, directoryLink);
	assert.match(await f.open(['photo.bin']), /^FILE /u);
	assert.equal(sha(await f.read(0, f.bytes.length)), sha(f.bytes));
	assert.equal(sha(await readFile(join(f.outside, 'photo.bin'))), sha(f.foreign));
}));

void test('every intermediate directory rejects symlink/junction traversal before file delivery', deadline, async context => fixture(context, async f => {
	await f.capture(f.root); await rename(join(f.root, 'nested'), join(f.root, 'old-nested'));
	await symlink(f.outside, join(f.root, 'nested'), directoryLink);
	assert.equal(await f.open(['nested', 'photo.bin']), `ERROR ${String(error.link)}`);
}));

void test('a final symlink cannot read an outside regular file', deadline, async context => fixture(context, async f => {
	await f.capture(f.root); await symlink(join(f.outside, 'photo.bin'), join(f.root, 'alias.bin'), 'file');
	assert.equal(await f.open(['alias.bin']), `ERROR ${String(error.link)}`);
}));

void test('relative native components reject empty/traversal/absolute/composite/NUL before open', deadline, async context => fixture(context, async f => {
	await f.capture(f.root);
	const invalid: readonly (readonly string[])[] = [[], [''], ['.'], ['..'], ['nested', '..', 'photo.bin'], [f.outside], ['nested/photo.bin'], ['photo\0.bin']];
	for (const components of invalid) assert.equal(await f.open(components), `ERROR ${String(error.invalidPath)}`);
	if (process.platform === 'win32') {
		for (const leaf of ['photo.bin:secret', 'nested\\photo.bin', 'C:photo.bin']) assert.equal(await f.open([leaf]), `ERROR ${String(error.invalidPath)}`);
	}
}));

void test('actual native filename components preserve native identity without UTF8 coercion', deadline, async context => fixture(context, async f => {
	await f.capture(f.root);
	if (process.platform === 'win32') {
		const name = 'photo-\ud800.bin';
		assert.equal(await f.request(`CREATE ${pathHex(join(f.root, name))} ${f.bytes.toString('hex')}`), 'CREATED');
		assert.match(await f.open([name]), /^FILE /u);
	} else {
		const name = Buffer.from([112, 104, 111, 116, 111, 45, 255, 46, 98, 105, 110]);
		const path = Buffer.concat([Buffer.from(`${f.root}/`), name]); await writeFile(path, f.bytes);
		assert.match(await f.open([name]), /^FILE /u);
	}
	assert.equal(sha(await f.read(0, f.bytes.length)), sha(f.bytes));
}));

void test('a captured actual file cannot be redirected by replacing its directory entry', deadline, async context => fixture(context, async f => {
	await f.capture(f.root); assert.match(await f.open(['photo.bin']), /^FILE /u);
	await rename(join(f.root, 'photo.bin'), join(f.root, 'old-photo.bin'));
	await writeFile(join(f.root, 'photo.bin'), f.foreign);
	const response = await f.request(`READ 0 ${String(f.bytes.length)}`);
	if (response.startsWith('DATA ')) assert.equal(sha(Buffer.from(response.slice(5), 'hex')), sha(f.bytes));
	else assert.equal(response, `ERROR ${String(error.changed)}`);
}));

void test('actual directory and nonregular FIFO are refused without blocking a native read', deadline, async context => fixture(context, async f => {
	await f.capture(f.root); assert.equal(await f.open(['nested']), `ERROR ${String(error.notRegular)}`);
	if (process.platform !== 'win32') {
		assert.equal(await f.request(`FIFO ${pathHex(join(f.root, 'pipe'))}`), 'FIFO');
		assert.equal(await f.open(['pipe']), `ERROR ${String(error.notRegular)}`);
	}
}));

void test('a retained actual regular file rejects same-size external mutation before returning bytes', deadline, async context => fixture(context, async f => {
	await f.capture(f.root); assert.match(await f.open(['photo.bin']), /^FILE /u);
	await writeFile(join(f.root, 'photo.bin'), Buffer.alloc(f.bytes.length, 122));
	assert.equal(await f.request('READ 0 1'), `ERROR ${String(error.changed)}`);
}));

void test('native range checks enforce one MiB and overflow-safe exact file boundaries', deadline, async context => fixture(context, async f => {
	await writeFile(join(f.root, 'large.bin'), Buffer.alloc(1048577, 7));
	await f.capture(f.root); assert.match(await f.open(['large.bin']), /^FILE /u);
	for (const [offset, length] of [[0n, 0], [0n, 1048577], [1048577n, 1], [18446744073709551615n, 2]] as const) {
		assert.equal(await f.request(`READ ${String(offset)} ${String(length)}`), `ERROR ${String(error.range)}`);
	}
	assert.equal(sha(await f.read(0, 1048576)), sha(Buffer.alloc(1048576, 7)));
}));

void test('root close stops new opens while an independently retained file owns its actual handle', deadline, async context => fixture(context, async f => {
	await f.capture(f.root); assert.match(await f.open(['photo.bin']), /^FILE /u);
	assert.equal(await f.request('ROOT_CLOSE'), 'CLOSED'); assert.equal(await f.request('ROOT_CLOSE'), 'CLOSED');
	assert.equal(sha(await f.read(0, f.bytes.length)), sha(f.bytes));
	// OPEN closes the previous file in the test peer, then reaches the actual closed root.
	assert.equal(await f.open(['photo.bin']), `ERROR ${String(error.closed)}`);
}));

void test('active cancellation with actual root/file handles joins native process retirement', deadline, async context => fixture(context, async f => {
	await f.capture(f.root); assert.match(await f.open(['photo.bin']), /^FILE /u);
	f.cancel(Symbol('cancel-native-owner')); const outcome = await f.joined;
	assert.ok(outcome.signal !== null || outcome.code !== 0);
	await assert.rejects(f.read(0, 1));
}));
