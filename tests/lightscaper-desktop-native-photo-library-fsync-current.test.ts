/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { acquireLightscaperNativePhotoLibraryWriterCurrentV1 as acquire } from '../desktop/lightscaper-native-photo-library-writer-current-v1.ts';
import { nativeGuardFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-photo-library-writer-fixture-current.ts';

test('Lightscaper library directory retry settles the actual parent fsync debt after mkdir already succeeded',
	{ skip: process.platform === 'win32' ? 'Portable Windows directory fsync is not claimed by this native owner.' : false }, async () => {
		await fixture(async f => {
			const expected = await lstat(f.appDataPath, { bigint: true });
			const probe = await open(f.appDataPath, constants.O_RDONLY), prototype: object = Object.getPrototypeOf(probe) as object;
			await probe.close();
			const descriptor = Object.getOwnPropertyDescriptor(prototype, 'sync')!;
			const actual = descriptor.value as FileHandle['sync'];
			const failure = Object.freeze({ source: 'actual-parent-directory-fsync-refused' }); let attempts = 0;
			Object.defineProperty(prototype, 'sync', { ...descriptor, value: async function (this: FileHandle): Promise<void> {
				const entry = await this.stat({ bigint: true });
				if (entry.isDirectory() && entry.dev === expected.dev && entry.ino === expected.ino) {
					attempts++; if (attempts === 1) throw failure;
				}
				await Reflect.apply(actual, this, []);
			} });
			try {
				await acquire(f.appDataPath).then(() => { throw new Error('The actual refused parent sync must reject opening.'); }, (reason: unknown) => { assert.equal(reason, failure); });
				assert.equal(attempts, 1); assert.equal((await lstat(join(f.appDataPath, 'Lightscaper'))).isDirectory(), true);
				const guard = f.own(await acquire(f.appDataPath)); guard.assertCurrent();
				assert.equal(attempts, 2, 'The EEXIST retry must authenticate and sync the same actual parent directory again.');
			} finally { Object.defineProperty(prototype, 'sync', descriptor); }
		});
	});
