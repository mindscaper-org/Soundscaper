/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
