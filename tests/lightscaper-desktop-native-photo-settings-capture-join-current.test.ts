/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import test from 'node:test';

test('Lightscaper native settings pair capture failure joins its admitted sibling Blob before close retires SQLite', async () => {
	let release!: () => void, began!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { began = resolve; });
	const original = Blob.prototype.arrayBuffer;
	// Install before the codec loads. The wrapper performs the genuine native
	// Blob read and holds its completion; no fake payload or repository is used.
	Blob.prototype.arrayBuffer = async function () {
		const bytes = await original.call(this); began(); await held; return bytes;
	};
	const { LightscaperNativePhotoSettingsCurrentV1: Owner } = await import('../desktop/lightscaper-native-photo-settings-current-v1.ts');
	const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native settings capture join ')));
	let owner: Awaited<ReturnType<typeof Owner.open>> | undefined;
	let operation: Promise<boolean> | undefined, closing: Promise<void> | undefined;
	try {
		owner = await Owner.open({ appDataPath });
		await owner.settingsRepository.put('pointer', 0);
		operation = owner.settingsRepository.replaceIfCurrentAndPutIfAbsent('pointer', 0,
			new Blob(['genuine delayed native body']), 'intent', () => undefined);
		void operation.catch(() => undefined);
		await started;
		let retired = false;
		closing = owner.close().then(() => { retired = true; });
		await yieldTurn(); await yieldTurn();
		assert.equal(retired, false, 'close retired while an accepted sibling native Blob capture was still held');
		release();
		await assert.rejects(operation, { name: 'DataCloneError' });
		await closing;
	} finally {
		release();
		await operation?.catch(() => undefined); await closing; await owner?.close();
		Blob.prototype.arrayBuffer = original;
		await rm(appDataPath, { recursive: true, force: true });
	}
});
