/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerLightscaperNativePhotoOriginalPinsCurrentV1 as register } from '../desktop/lightscaper-native-photo-original-read-pins-current-v1.ts';
import { test, fixture, remainsPending, deferred, withGroup, Media, Originals } from './helpers/lightscaper-native-original-group-fixture-current.ts';

void test('Lightscaper native pin owner retires a genuinely unused group booking on close', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const owner = register(f.database), booking = owner.reserveGroup(2); let closing: Promise<void> | undefined;
		try { closing = owner.close(); void closing.catch(() => undefined); assert.equal(await remainsPending(closing), false); await closing; }
		finally { booking.release(); await (closing ?? owner.close()); }
	});
});
void test('Lightscaper native group retains all activated slots while first actual Photo authority receipt is pending during Media close', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const peer = await Media.open({ appDataPath: f.appDataPath }), entered = deferred(), release = deferred();
		const native = f.catalog.loadPhoto, descriptor = Object.getOwnPropertyDescriptor(f.catalog, 'loadPhoto'); let held = false;
		Object.defineProperty(f.catalog, 'loadPhoto', { configurable: true, value: function (...args: Parameters<typeof native>) {
			const actual = Reflect.apply(native, f.catalog, args) as ReturnType<typeof native>;
			return actual.then(async photo => { if (!held) { held = true; entered.resolve(); await release.promise; } return photo; });
		} });
		const reader = Originals.create({ catalog: f.catalog, media: f.media, settings: f.settings,
			scope: { signal: f.scope.signal, assertCurrent: () => { f.scope.signal.throwIfAborted(); } } });
		let closing: Promise<void> | undefined, unexpected: Readonly<{ release(): void }> | undefined, delivered = 0;
		const work = withGroup(reader, [f.request], () => { delivered++; }); void work.catch(() => undefined);
		try {
			await entered.promise; closing = f.media.close(); void closing.catch(() => undefined);
			assert.equal(await remainsPending(closing), true);
			assert.throws(() => { unexpected = peer.reserveOriginalGroup(4094); }, /capacity/u);
		} finally {
			unexpected?.release(); release.resolve(); await Promise.allSettled([work, ...(closing ? [closing] : [])]);
			try { await reader.close(); } finally { try { await peer.close(); } finally {
				if (descriptor) Object.defineProperty(f.catalog, 'loadPhoto', descriptor); else Reflect.deleteProperty(f.catalog, 'loadPhoto');
			} }
		}
		await assert.rejects(work); assert.equal(delivered, 0); await closing;
	});
});
