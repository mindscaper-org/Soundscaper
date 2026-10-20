/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	listSelectableExternalDisplays,
	resolveExternalDisplayColorMode,
	NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES,
	type ExternalDisplayDescriptorV1,
} from '../src/common/editor/native-external-display.ts';

test('the bounded frame contract admits the registered UHD clean-display cohort', () => {
	const uhdRgbaBytes = 3_840 * 2_160 * 4;
	assert.ok(NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES >= uhdRgbaBytes);
	assert.equal(NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES, 64 * 1_024 * 1_024);
});

test('the menu offers non-primary displays only', () => {
	const displays = [primary(), secondary('display-2'), secondary('display-3')];

	assert.deepEqual(
		listSelectableExternalDisplays(displays, 'x11').map((display) => display.displayId),
		['display-2', 'display-3'],
	);
	assert.deepEqual(listSelectableExternalDisplays([primary()], 'macos'), []);
});

test('native Wayland reports unavailable instead of approximating placement', () => {
	const displays = [primary(), secondary('display-2')];

	assert.deepEqual(listSelectableExternalDisplays(displays, 'wayland'), []);
	// XWayland presents as x11 and is where Linux coverage runs.
	assert.equal(listSelectableExternalDisplays(displays, 'x11').length, 1);

});

test('HDR is claimed only when the display is both capable and colour managed', () => {
	assert.equal(resolveExternalDisplayColorMode(secondary('d', { hdrCapable: true, colorManaged: true })), 'hdr');
	assert.equal(resolveExternalDisplayColorMode(secondary('d', { hdrCapable: true, colorManaged: false })), 'sdr');
	assert.equal(resolveExternalDisplayColorMode(secondary('d', { hdrCapable: false, colorManaged: true })), 'sdr');
	assert.equal(resolveExternalDisplayColorMode(secondary('d')), 'sdr');
});

function primary(): ExternalDisplayDescriptorV1 {
	return {
		displayId: 'display-1', label: 'Built-in', primary: true,
		width: 2_560, height: 1_440, hdrCapable: false, colorManaged: false,
	};
}

function secondary(
	displayId: string,
	overrides: Partial<ExternalDisplayDescriptorV1> = {},
): ExternalDisplayDescriptorV1 {
	return {
		displayId, label: 'Programme', primary: false,
		width: 1_920, height: 1_080, hdrCapable: false, colorManaged: false,
		...overrides,
	};
}
