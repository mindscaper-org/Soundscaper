/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../desktop/lightscaper-native-photo-media-current-v1.ts';
import { assert, nativeOriginalInspectionFixtureCurrentV1 as fixture,
	INSPECTION_OPTIONS_CURRENT_V1 as options } from './helpers/lightscaper-native-original-inspection-fixture-current.ts';

void test('Lightscaper native one-shot inspection refuses a head switched during its real held body read', options, async t => {
	await fixture(t, async f => {
		const peer = await Media.open({ appDataPath: f.appDataPath });
		try {
			await f.hold(async gate => {
				const inspection = f.inspect(); void inspection.catch(() => undefined); await gate.entered;
				await f.track(peer.restoreCatalogOriginalBody(f.binding, new Blob([Uint8Array.from(f.bytes)]), { signal: f.signal }));
				gate.release(); await assert.rejects(inspection, /head|changed/iu);
			});
			assert.deepEqual(await f.inspect(), { status: 'present' });
		} finally { await peer.close(); }
	});
});
