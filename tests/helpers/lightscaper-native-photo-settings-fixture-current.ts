/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoSettingsCurrentV1 } from '../../desktop/lightscaper-native-photo-settings-current-v1.ts';

/** Real private appData and real owners; no in-memory repository substitutes. */
export async function nativeSettingsFixtureCurrentV1(context: TestContext, scope = 'anchor') {
	const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native settings ü ')));
	const owners: LightscaperNativePhotoSettingsCurrentV1[] = [];
	context.after(async () => {
		const results = await Promise.allSettled(owners.map(owner => owner.close()));
		const failed = results.filter(result => result.status === 'rejected');
		if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Settings fixture retirement failed.');
		await rm(appDataPath, { recursive: true, force: true });
	});
	const open = async (binding = scope) => {
		const owner = await LightscaperNativePhotoSettingsCurrentV1.open({ appDataPath, scope: binding });
		owners.push(owner);
		return owner;
	};
	const owner = await open();
	return { appDataPath, owner, settings: owner.settingsRepository, open,
		databasePath: join(appDataPath, 'Lightscaper', 'project-library', 'v1', 'native-photo-settings.sqlite3') };
}
