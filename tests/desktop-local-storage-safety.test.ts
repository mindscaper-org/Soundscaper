/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertLocalDesktopStorage } from '../desktop/local-storage-safety.ts';
import { isLocalDesktopVolume } from '../desktop/local-storage-volume.ts';
import { TemporaryProjectStorage } from '../desktop/temporary-project-storage.ts';

function home(t: test.TestContext): string {
	const path = mkdtempSync(join(tmpdir(), 'scape-local-storage-'));
	t.after(() => rmSync(path, { recursive: true, force: true }));
	return path;
}

test('known synchronized paths are refused before temporary storage is created or selected', async t => {
	const root = home(t), config = join(root, 'settings.json');
	const storage = new TemporaryProjectStorage(config, root, 'Soundscaper');
	for (const name of ['OneDrive', 'OneDrive - Company', 'Dropbox', 'Google Drive', 'iCloudDrive', 'Nextcloud']) {
		const selected = join(root, name, 'working');
		await assert.rejects(storage.select(selected), /local.*unsynced/iu);
		assert.equal(existsSync(selected), false);
		assert.equal(existsSync(config), false);
		assert.equal(storage.status().selectedFolder, root);
	}
});

test('persisted unsafe selections are refused before migration touches either library', async t => {
	const root = home(t), config = join(root, 'settings.json'), original = join(root, 'original');
	const selected = join(root, 'Dropbox', 'working');
	const source = join(original, 'Soundscaper', 'project-library', 'v1');
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, 'library.sqlite3'), 'original evidence');
	writeFileSync(config, JSON.stringify({ active: original, selected }));
	await assert.rejects(new TemporaryProjectStorage(config, root, 'Soundscaper').prepare(), /local.*unsynced/iu);
	assert.equal(readFileSync(join(source, 'library.sqlite3'), 'utf8'), 'original evidence');
	assert.equal(existsSync(selected), false);
});

test('symlinks and provider-configured custom sync roots cannot hide a synchronized destination', t => {
	const root = home(t), synced = join(root, 'OneDrive');
	mkdirSync(synced);
	symlinkSync(synced, join(root, 'alias'), 'junction');
	assert.throws(() => assertLocalDesktopStorage(join(root, 'alias', 'new')), /local.*unsynced/iu);
	const custom = join(root, 'arbitrary-name');
	mkdirSync(custom);
	assert.throws(() => assertLocalDesktopStorage(join(custom, 'new'), {
		environment: { OneDriveCommercial: custom },
	}), /local.*unsynced/iu);
	assert.doesNotThrow(() => assertLocalDesktopStorage(join(root, 'local'), {
		environment: { OneDrive: join(root, 'not-created-yet') },
	}));
	mkdirSync(join(root, '.dropbox'));
	writeFileSync(join(root, '.dropbox', 'info.json'), JSON.stringify({ personal: { path: custom } }));
	assert.throws(() => assertLocalDesktopStorage(join(custom, 'new'), { homePath: root }), /local.*unsynced/iu);
});

test('cloud provider roots, UNC paths and unresolved network volumes are refused', t => {
	const root = home(t);
	for (const path of [join(root, 'Library', 'CloudStorage', 'custom', 'new'),
		join(root, 'Library', 'Mobile Documents', 'new'), '\\\\server\\share\\working', '//server/share/working']) {
		assert.throws(() => assertLocalDesktopStorage(path), /local.*unsynced/iu);
	}
	assert.throws(() => assertLocalDesktopStorage(root, { volumeIsLocal: () => false }), /local.*unsynced/iu);
	assert.throws(() => assertLocalDesktopStorage(root, { volumeIsLocal: () => { throw new Error('offline'); } }), /offline/u);
	assert.doesNotThrow(() => assertLocalDesktopStorage(join(root, 'new', 'working')));
});

test('Linux refuses NFS, SMB, FUSE, cluster and unknown filesystem types', () => {
	for (const type of [0x6969, 0xff534d42, 0xfe534d42, 0x65735546, 0x00c36400, 0x7461636f, 0xdeadbeef]) {
		assert.equal(isLocalDesktopVolume('/path', { platform: 'linux', filesystemType: () => type }), false);
	}
	assert.equal(isLocalDesktopVolume('/path', { platform: 'linux', filesystemType: () => 0xef53 }), true);
});

test('Windows mapped drives and macOS volumes require a positive OS locality result', () => {
	for (const platform of ['win32', 'darwin'] as const) {
		for (const result of ['local', 'remote', '', 'Unknown']) {
			assert.equal(isLocalDesktopVolume('/path with $() and quotes', {
				platform, run: (_file, args, environment) => {
					assert.equal(args.some(argument => argument.includes('/path with')), false);
					assert.equal(environment.SOUNDSCAPER_STORAGE_PROBE_PATH, '/path with $() and quotes');
					return result;
				},
			}), result === 'local');
		}
	}
});

test('an unavailable OS volume helper fails closed', t => {
	const root = home(t);
	assert.throws(() => isLocalDesktopVolume(root, {
		platform: 'win32', environment: { SystemRoot: join(root, 'missing-system') },
	}), /ENOENT/u);
});
