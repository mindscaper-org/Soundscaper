/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerLightscaperNativePhotoOriginalPinsCurrentV1 as register } from '../desktop/lightscaper-native-photo-original-read-pins-current-v1.ts';
import { test, fixture, remainsPending, exactFailure } from './helpers/lightscaper-native-original-group-fixture-current.ts';

/** Actual file-backed pin ownership, not a substitute successful reader. A
 * negative trusted cleanup receipt must retain capacity and settle close with
 * rejection even when no alias remains able to resolve the booking. */
void test('Lightscaper native group unproved booking retains every slot while actual owner close rejects instead of hanging', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const owner = register(f.database), peer = register(f.database), booking = owner.reserveGroup(2);
		const reason = new AggregateError([Symbol('exact native cleanup fault')], 'Owned group retirement receipt failed.');
		try {
			const quarantine: unknown = Reflect.get(booking, 'quarantine');
			assert.equal(typeof quarantine, 'function', 'Genuine group reservation must record failed retirement without releasing count.');
			Reflect.apply(quarantine as (error: unknown) => void, booking, [reason]);
			booking.release(); assert.throws(() => peer.reserveGroup(4093), /capacity/u);
			const closing = owner.close(); void closing.catch(() => undefined); assert.equal(owner.close(), closing);
			assert.equal(await remainsPending(closing), false); await exactFailure(closing, reason);
		} finally {
			// Missing/incorrect implementation RED must also release its real
			// booking before joining registration close. Quarantine is immutable.
			booking.release(); await Promise.allSettled([owner.close(), peer.close()]);
		}
	});
});
