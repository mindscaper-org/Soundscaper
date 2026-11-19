/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { SoundscaperDesktopProjectLibraryMain } from '../desktop/soundscaper-project-library-main.ts';
import { FramescaperDesktopProjectLibraryMain } from '../desktop/framescaper-project-library-main.ts';
import { createSoundscaperDesktopProjectLibraryHandshake, createSoundscaperDesktopProjectLibraryPaths } from '../desktop/soundscaper-project-library-contract.ts';
import { createFramescaperDesktopProjectLibraryHandshake, createFramescaperDesktopProjectLibraryPaths } from '../desktop/framescaper-project-library-contract.ts';
import { SoundscaperDeliveryService } from '../desktop/soundscaper-delivery-service.ts';
import { createUnavailableSoundscaperDeliveryFilesystemAuthority } from '../desktop/soundscaper-delivery-filesystem-authority.ts';
import { startFramescaperNativeServicesRuntimeV3 } from '../desktop/native-services-runtime-v3.ts';
import { openLocalDesktopDatabase } from '../desktop/desktop-database.ts';

test('opening in an existing directory admits its volume once and creating a directory also checks before mkdir', {
	skip: process.platform !== 'linux',
}, async t => {
	const root = await mkdtemp(join(tmpdir(), 'scape-database-volume-probes-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const probe = t.mock.method(fs, 'statfsSync');
	syncBuiltinESMExports();
	t.after(() => { probe.mock.restore(); syncBuiltinESMExports(); });

	const existing = openLocalDesktopDatabase(join(root, 'existing.sqlite'));
	try { assert.equal(probe.mock.callCount(), 1); }
	finally { existing.close(); }

	probe.mock.resetCalls();
	const createdDirectory = join(root, 'new-parent');
	const created = openLocalDesktopDatabase(join(createdDirectory, 'new.sqlite'));
	try {
		assert.deepEqual(probe.mock.calls.map(call => call.arguments[0]), [fs.realpathSync(root), fs.realpathSync(createdDirectory)]);
	} finally { created.close(); }
});

test('an unsupported network path is refused before inspecting its database directory', t => {
	const inspect = t.mock.method(fs, 'statSync');
	syncBuiltinESMExports();
	t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
	assert.throws(() => openLocalDesktopDatabase('//drive.invalid/share/working/library.sqlite'), /local, unsynced storage/u);
	assert.equal(inspect.mock.callCount(), 0);
});

for (const name of ['soundscaper', 'framescaper', 'delivery', 'native-services'] as const) {
	test(`${name} startup refuses WAL evidence before database initialization or recovery`, async t => {
		const root = await mkdtemp(join(tmpdir(), 'scape-open-guard-'));
		t.after(() => rm(root, { recursive: true, force: true }));
		const path = name === 'soundscaper' ? createSoundscaperDesktopProjectLibraryPaths(root).databasePath
			: name === 'framescaper' ? createFramescaperDesktopProjectLibraryPaths(root).databasePath
				: join(root, 'services.sqlite');
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, 'main database evidence');
		await writeFile(`${path}-wal`, 'sidecar evidence');
		await assert.rejects(async () => {
			if (name === 'soundscaper') {
				await SoundscaperDesktopProjectLibraryMain.start({ appDataPath: root,
					owner: { product: name, processId: process.pid, instanceId: 'startup-safety' },
					handshake: createSoundscaperDesktopProjectLibraryHandshake(), onLeaseLost: () => undefined, testControl: null });
			} else if (name === 'framescaper') {
				await FramescaperDesktopProjectLibraryMain.start({ appDataPath: root,
					owner: { product: name, processId: process.pid, instanceId: 'startup-safety' },
					handshake: createFramescaperDesktopProjectLibraryHandshake(), onLeaseLost: () => undefined, testControl: null });
			} else if (name === 'delivery') {
				await SoundscaperDeliveryService.start({ databasePath: path, readProjectIdentity: () => null,
					filesystem: createUnavailableSoundscaperDeliveryFilesystemAuthority('Unavailable in the storage-safety test.') });
			} else {
				startFramescaperNativeServicesRuntimeV3({ databasePath: path, leaseId: 'startup-safety',
					instanceId: 'startup-safety', processId: process.pid, runtimeAvailable: () => false, nativeMediaEnabled: () => false });
			}
		}, /WAL sidecar/u);
		assert.equal(await readFile(path, 'utf8'), 'main database evidence');
		assert.equal(await readFile(`${path}-wal`, 'utf8'), 'sidecar evidence');
	});
}
