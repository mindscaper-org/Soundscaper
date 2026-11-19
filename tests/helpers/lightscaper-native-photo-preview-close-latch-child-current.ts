/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LightscaperNativePhotoPreviewCacheCurrentV1 as Cache } from '../../desktop/lightscaper-native-photo-preview-cache-current-v1.ts';
import { nativePreviewProfileCurrentV1 as profile } from './lightscaper-native-photo-preview-cache-fixture-current.ts';
export interface NativePreviewCloseLatchInputCurrentV1 { readonly appDataPath: string }
const directory = process.argv[2]; if (!directory) throw new Error('Missing owned preview fixture.');
const cachePath = join(directory, 'Lightscaper', 'project-library', 'v1', 'native-photo-preview-cache.sqlite3');
const input: Readonly<NativePreviewCloseLatchInputCurrentV1> = { appDataPath: directory };
const first = await Cache.open(input), sibling = await Cache.open(input);
const core = sibling.createBinaryDerivativeCache(profile()), actual = DatabaseSync.prototype.close, work: Promise<unknown>[] = [];
let failed = false, reentered = false, reflected = 0;
DatabaseSync.prototype.close = function (): void {
	const file = this.prepare('PRAGMA database_list').get()?.file; Reflect.apply(actual, this, []);
	if (!failed && file === cachePath) { failed = true; throw new Error('Actual first close returned an unproved terminal witness.'); }
	if (failed && !reentered) {
		reentered = true; const trap = new Proxy({}, { ownKeys() { reflected++; return []; } });
		const pending = core.load(trap); work.push(pending); void pending.catch(() => undefined);
	}
};
try { await assert.rejects(first.close()); } finally { DatabaseSync.prototype.close = actual; }
await Promise.allSettled(work); await sibling.close();
assert.equal(failed, true); assert.equal(reentered, true); assert.equal(reflected, 0);
