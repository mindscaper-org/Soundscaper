/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLibRawRuntimeAssetUrlCurrentV1 } from '../src/common/editor/raw/libraw-runtime-asset-location-current-v1.ts';

const ASSETS = [
	'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm',
	'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm',
] as const;

test('Lightscaper packaged RAW uses its same-origin runtime route for both immutable ABIs', () => {
	for (const asset of ASSETS) {
		for (const page of ['lightscaper-app://bundle/', 'lightscaper-app://bundle/de/editor/?theme=dark#develop']) {
			assert.equal(resolveLibRawRuntimeAssetUrlCurrentV1(asset, page),
				`lightscaper-app://bundle${new URL(asset).pathname}`);
		}
	}
});

test('ordinary browser and other product contexts preserve each exact published RAW URL', () => {
	for (const asset of ASSETS) {
		for (const page of [undefined, 'https://lightscaper.org/', 'http://127.0.0.1:4322/en/editor/',
			'file:///opt/Lightscaper/index.html', 'soundscaper-app://bundle/', 'framescaper-app://bundle/',
			'lightscaper-apps://bundle/', 'https://lightscaper-app.bundle/']) {
			assert.equal(resolveLibRawRuntimeAssetUrlCurrentV1(asset, page), asset);
		}
	}
});

test('packaged RAW refuses credentials, ports and lookalike Lightscaper authorities', () => {
	for (const page of ['lightscaper-app://bundle.evil/', 'lightscaper-app://evil/', 'lightscaper-app://bundle:4322/',
		'lightscaper-app://bundle:/', 'lightscaper-app://user@bundle/', 'lightscaper-app://user:secret@bundle/',
		'lightscaper-app://bundle@evil/', 'lightscaper-app://BUNDLE/', 'lightscaper-app://%62undle/',
		'lightscaper-app:///bundle/', 'lightscaper-app:bundle', ' lightscaper-app://bundle/']) {
		assert.throws(() => resolveLibRawRuntimeAssetUrlCurrentV1(ASSETS[0], page), TypeError, page);
	}
});

test('RAW transport admits neither substituted asset origins nor modified versioned paths', () => {
	for (const asset of ['https://evil.example/runtime/libraw/0.22.2/libraw.wasm',
		'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm?cache=1',
		'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm#different',
		'https://assets.soundscaper.org/runtime/libraw/0.22.3/libraw.wasm',
		'lightscaper-app://bundle/runtime/libraw/0.22.2/libraw.wasm']) {
		assert.throws(() => resolveLibRawRuntimeAssetUrlCurrentV1(asset, 'lightscaper-app://bundle/'), TypeError);
	}
});

test('RAW location resolution reads the actual packaged context when no context is supplied', () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
	try {
		Object.defineProperty(globalThis, 'location', { configurable: true,
			value: { href: 'lightscaper-app://bundle/en/editor/' } });
		assert.equal(resolveLibRawRuntimeAssetUrlCurrentV1(ASSETS[1]),
			'lightscaper-app://bundle/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm');
	} finally {
		if (previous) Object.defineProperty(globalThis, 'location', previous);
		else Reflect.deleteProperty(globalThis, 'location');
	}
});
