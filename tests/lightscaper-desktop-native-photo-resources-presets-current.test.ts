/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoResourcesCurrentV1 } from '../desktop/lightscaper-native-photo-resources-current-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { createImageDevelopPresetV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { copyImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { normalizeImageDevelopPresetCurrentV1 } from '../src/common/editor/imaging/image-develop-preset-current-v1.ts';
import { createImageDevelopPresetForProfileV1 } from '../src/common/editor/imaging/internal/image-develop-preset-kernel-v1.ts';
import { nativeBrushResourceCurrentV1, nativeCubeResourceCurrentV1, nativeResourceFixtureCurrentV1 } from './helpers/lightscaper-native-photo-resources-fixture-current.ts';

const selection = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
function lutDevelop() {
	return { ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: 'disabled-profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: nativeCubeResourceCurrentV1().reference } }] };
}
function selectedPreset(version: 3 | 4) {
	const brush = nativeBrushResourceCurrentV1(), base = normalizeImageDevelopStateV3({ ...lutDevelop(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [] }, masks: [{ schemaVersion: 2, id: 'unused', name: 'Unused brush', kind: 'matte',
			inputs: [{ name: 'Alpha', sourceRef: brush.reference.storageKey, kind: 'raster' }],
			nodes: [{ id: 'out', kind: 'raster', inputName: 'Alpha', channel: 'alpha' }], outputNodeId: 'out' }], maskBindings: [] });
	if (version === 3) return createImageDevelopPresetForProfileV1('current3', { schemaVersion: 3, id: 'preset3', name: 'Selected3',
		settings: { schemaVersion: 3, kind: 'photo-develop-settings', selection: { ...selection, repairs: true }, develop: base } }, 'selected');
	const develop = normalizeImageDevelopStateV4({ ...base, processVersion: 4, rawDevelopment: { schemaVersion: 1, mode: 'canonical' } });
	return createImageDevelopPresetForProfileV1('current4', { schemaVersion: 4, id: 'preset4', name: 'Selected4',
		settings: { schemaVersion: 4, kind: 'photo-develop-settings', selection: { ...selection, repairs: true, rawDevelopment: true }, develop } }, 'selected');
}

test('native family verifiers retain genuine preset1 and preset2 grammar and authenticate disabled LUTs', async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath });
		try {
			const lut = await owner.cubeLutResources(), brush = await owner.maskRasterResources();
			const preset1 = createImageDevelopPresetV1({ schemaVersion: 1, id: 'preset1', name: 'One',
				settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(), selection }) });
			const preset2 = createImageDevelopPresetV2({ schemaVersion: 2, id: 'preset2', name: 'Two',
				settings: copyImageDevelopSettingsV2({ schemaVersion: 2, develop: lutDevelop(), selection }) });
			await lut.verifyPreset(preset1); await brush.verifyPreset(preset1);
			await assert.rejects(lut.verifyPreset(preset2)); const input = nativeCubeResourceCurrentV1();
			await lut.put(input.reference, input.bytes); await lut.verifyPreset(preset2); await brush.verifyPreset(preset2);
		} finally { await owner.close(); }
	});
});

for (const version of [3, 4] as const) test(`native selected preset${String(version)} verifies disabled LUT plus unbound brush input without widening external grammar`, async () => {
	await nativeResourceFixtureCurrentV1(async appDataPath => {
		const owner = await LightscaperNativePhotoResourcesCurrentV1.open({ appDataPath }), preset = selectedPreset(version);
		try {
			assert.throws(() => normalizeImageDevelopPresetCurrentV1(preset), /External mask media/u);
			const lut = await owner.cubeLutResources(), brush = await owner.maskRasterResources();
			await assert.rejects(lut.verifyPreset(preset)); await assert.rejects(brush.verifyPreset(preset));
			const a = nativeCubeResourceCurrentV1(), b = nativeBrushResourceCurrentV1();
			await lut.put(a.reference, a.bytes); await lut.verifyPreset(preset); await assert.rejects(brush.verifyPreset(preset));
			await brush.put(b.reference, b.bytes); await brush.verifyPreset(preset);
			await assert.rejects(lut.verifyPreset({ ...preset, identity: { ...preset.identity, authoredStateSha256: '00'.repeat(32) } }));
		} finally { await owner.close(); }
	});
});
