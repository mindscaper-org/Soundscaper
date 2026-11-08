/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import test from 'node:test';
import type { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import type { LightscaperNativePhotoImportPresetsCurrentV1 as Facet } from '../desktop/lightscaper-native-photo-import-presets-current-v1.ts';

void test('Lightscaper queued import-preset CAS refuses retired epoch before SQL while Close joins held genuine Blob capture', { timeout: 15_000 }, async context => {
	let release!: () => void, entered!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
	const original = Blob.prototype.arrayBuffer, controller = new AbortController(), reason = Symbol('selected epoch retired during earlier native capture');
	const stop = (): void => { controller.abort(reason); release(); entered(); };
	context.signal.addEventListener('abort', stop, { once: true }); const timer = setTimeout(stop, 15_000);
	Blob.prototype.arrayBuffer = async function () { const bytes = await Reflect.apply(original, this, []); entered(); await held; return bytes; };
	let owner: Settings | undefined, facet: Facet | undefined, first: Promise<unknown> | undefined, work: Promise<unknown> | undefined, closing: Promise<void> | undefined;
	const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper import facet native capture ')));
	let failed = false, primary: unknown;
	try {
		const { LightscaperNativePhotoSettingsCurrentV1: Owner } = await import('../desktop/lightscaper-native-photo-settings-current-v1.ts');
		const { LightscaperNativePhotoImportPresetsCurrentV1: ImportPresets } = await import('../desktop/lightscaper-native-photo-import-presets-current-v1.ts');
		const { photoImportPresetsKeyV1 } = await import('../src/lightscaper/storage/photo-import-presets-v1.ts');
		owner = await Owner.open({ appDataPath }); facet = ImportPresets.create(owner, 'catalog', { signal: controller.signal, assertCurrent() {} });
		first = owner.settingsRepository.put('unrelated-native-blob', new Blob(['genuine native settings capture'])); void first.catch(() => undefined);
		await started;
		const payload = { revision: 1 }, key = photoImportPresetsKeyV1('catalog');
		work = facet.settingsRepository.putIfAbsent(key, payload); void work.catch(() => undefined); payload.revision = 99;
		controller.abort(reason); let closed = false; closing = facet.close(); void closing.then(() => { closed = true; });
		await yieldTurn(); await yieldTurn(); assert.equal(closed, false, 'facet Close abandoned its accepted queued native Settings work');
		release(); await first;
		let refused = false; await work.then(() => undefined, (failure: unknown) => { refused = true; assert.equal(failure, reason); }); assert.equal(refused, true);
		await closing; assert.deepEqual(await owner.settingsRepository.readEntry(key), { present: false });
	} catch (error) { failed = true; primary = error; }
	stop(); await Promise.allSettled([first, work, closing]);
	const retired = await Promise.allSettled([facet?.close(), owner?.close()]);
	clearTimeout(timer); context.signal.removeEventListener('abort', stop); Blob.prototype.arrayBuffer = original;
	const failures = retired.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
	if (failures.length) throw new AggregateError([...(failed ? [primary] : []), ...failures], 'Held import-preset fixture retained unretired owners.', { cause: failures[0] });
	await rm(appDataPath, { recursive: true, force: true });
	if (failed) throw primary;
});
