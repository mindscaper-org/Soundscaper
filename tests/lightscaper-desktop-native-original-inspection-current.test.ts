/* SPDX-License-Identifier: AGPL-3.0-only */

import { chmod, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { assert, dirname, nativeOriginalInspectionFixtureCurrentV1 as fixture,
	INSPECTION_OPTIONS_CURRENT_V1 as options } from './helpers/lightscaper-native-original-inspection-fixture-current.ts';

void test('Lightscaper native inspection returns present from actual managed bytes without decoding hostile metadata', options, async t => {
	await fixture(t, async f => {
		f.db.exec("UPDATE native_photo_media_assets SET metadata=zeroblob(8192)");
		assert.deepEqual(await f.inspect(), { status: 'present' });
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native inspection reports a positively absent body file', options, async t => {
	await fixture(t, async f => { await rm(f.path); assert.deepEqual(await f.inspect(), { status: 'missing', reason: 'file' }); });
});

void test('Lightscaper native inspection reports a positively absent body directory', options, async t => {
	await fixture(t, async f => { await rm(dirname(f.path), { recursive: true }); assert.deepEqual(await f.inspect(), { status: 'missing', reason: 'directory' }); });
});

void test('Lightscaper native inspection reports stable actual size corruption', options, async t => {
	await fixture(t, async f => { await writeFile(f.path, f.bytes.subarray(1)); assert.deepEqual(await f.inspect(), { status: 'corrupt', reason: 'size' }); });
});

void test('Lightscaper native inspection reports stable digest corruption after an earlier successful authentication', options, async t => {
	await fixture(t, async f => {
		assert.deepEqual(await f.inspect(), { status: 'present' });
		const changed = Uint8Array.from(f.bytes); changed[0] = (changed[0] ?? 0) ^ 1;
		await writeFile(f.path, changed); assert.deepEqual(await f.inspect(), { status: 'corrupt', reason: 'digest' });
	});
});

void test('Lightscaper native inspection refuses a body symlink while preserving foreign bytes', options, async t => {
	await fixture(t, async f => {
		const foreign = f.path + '.foreign'; await rename(f.path, foreign); await symlink(foreign, f.path);
		await assert.rejects(f.inspect()); await rm(f.path); await rename(foreign, f.path);
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native inspection refuses a symlinked body directory', options, async t => {
	await fixture(t, async f => {
		const directory = dirname(f.path), moved = directory + '.foreign'; await rename(directory, moved); await symlink(moved, directory, 'dir');
		try { await assert.rejects(f.inspect()); } finally { await rm(directory); await rename(moved, directory); }
	});
});

void test('Lightscaper native inspection does not classify a backend shape error as missing', options, async t => {
	await fixture(t, async f => {
		await rm(f.path); await mkdir(f.path); await assert.rejects(f.inspect());
		await rm(f.path, { recursive: true });
	});
});

void test('Lightscaper native inspection propagates actual permission refusal', options, async t => {
	if (process.platform === 'win32' || process.getuid?.() === 0) { t.skip('POSIX non-root permission refusal'); return; }
	await fixture(t, async f => {
		await chmod(f.path, 0o000);
		try { await assert.rejects(f.inspect(), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'EACCES'); }
		finally { await chmod(f.path, 0o600); }
	});
});
