/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readDesktopLightscaperArchiveOpenDescriptorCurrentV1 as readDescriptor,
	readDesktopLightscaperArchiveOpenFinishCurrentV1 as readFinish,
	readDesktopLightscaperArchiveOpenAvailabilityCurrentV1 as readAvailability } from '../src/common/editor/desktop-lightscaper-archive-open-contract-current-v1.ts';

function descriptor(name = 'Owned photo.liscape') {
	const id = 'a'.repeat(64);
	return { id, url: `lightscaper-app://bundle/_desktop/read/scape-range-v1/${id}/${encodeURIComponent(name)}`,
		name, size: 42, mimeType: 'application/vnd.soundscaper.scape+zip', readProfile: 'scape-range-v1', lastModified: 0 };
}

test('Lightscaper archive descriptor preserves only the exact native seven-field range authority for every Scape suffix', () => {
	for (const name of ['Photo.liscape', 'Legacy.scape', 'Sound.sscape', 'Frame.fscape', 'Ä photo.LISCAPE']) {
		const input = descriptor(name), result = readDescriptor(input);
		assert.deepEqual(result, input); assert.equal(Object.isFrozen(result), true); assert.notEqual(result, input);
	}
	assert.equal(readDescriptor({ ...descriptor(), size: Number.MAX_SAFE_INTEGER }).size, Number.MAX_SAFE_INTEGER);
});

test('Lightscaper archive descriptor rejects paths, foreign routes, widened fields and getters without invoking them', () => {
	const good = descriptor(); let called = false;
	const getter = { ...good }; Object.defineProperty(getter, 'name', { enumerable: true, get() { called = true; return good.name; } });
	for (const candidate of [getter, { ...good, path: '/private/owned.liscape' }, { ...good, id: 'a'.repeat(63) },
		{ ...good, readProfile: 'materialized-v1' }, { ...good, mimeType: 'application/zip' }, { ...good, size: -1 },
		{ ...good, size: -0 }, { ...good, size: Number.MAX_SAFE_INTEGER + 1 }, { ...good, lastModified: -1 },
		descriptor('../Owned.liscape'), descriptor('Owned.liscape.zip'), descriptor('Owned\n.liscape'),
		{ ...good, url: good.url.replace('bundle/', 'bundle:443/') }, { ...good, url: good.url.replace('bundle/', 'bundle.evil/') },
		{ ...good, url: good.url.replace('bundle/', 'user@bundle/') }, { ...good, url: `${good.url}?path=private` },
		{ ...good, url: good.url.replace('lightscaper-app:', 'soundscaper-app:') }, { ...good, url: `${good.url}#fragment` }]) {
		assert.throws(() => readDescriptor(candidate));
	}
	assert.equal(called, false);
});

test('Lightscaper archive finish and availability wire records are closed inert scalar values', () => {
	assert.deepEqual(readFinish({ id: 'b'.repeat(64) }), { id: 'b'.repeat(64) });
	assert.deepEqual(readAvailability({ available: true }), { available: true });
	assert.deepEqual(readAvailability({ available: false }), { available: false });
	for (const value of [{ id: 'x' }, { id: 'b'.repeat(64), path: 'secret' }, {}, null]) assert.throws(() => readFinish(value));
	for (const value of [true, { available: 1 }, { available: true, descriptor: descriptor() }]) assert.throws(() => readAvailability(value));
});
