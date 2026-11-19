/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as codec from '../src/lightscaper/desktop-photo-clone-current-v1.ts';

const object = (value: unknown): Record<string, unknown> => { assert.ok(value && typeof value === 'object'); return value as Record<string, unknown>; };
function measure(value: unknown): number {
	const method: unknown = Reflect.get(codec, 'measureDesktopPhotoCloneCurrentV1'); assert.equal(typeof method, 'function');
	return Reflect.apply(method as (value: unknown) => number, codec, [value]) as number;
}

void test('Desktop portable metadata reserves actual bounded graph debt without mutating host aliases or Maps', { timeout: 15_000 }, async () => {
	const blob = new Blob([new Uint8Array(1_048_576)]), wire = object(await codec.captureDesktopPhotoCloneCurrentV1({ blob, aliases: [blob, blob], map: new Map([['body', blob]]) }));
	try {
		const graph = object(wire.value), before = graph.blob; assert.ok(graph.map instanceof Map); Object.freeze(graph);
		const bytes = measure(wire); assert.ok(bytes > blob.size); assert.ok(bytes < blob.size + 4096); assert.equal(measure(wire), bytes);
		assert.equal(graph.blob, before); assert.equal(graph.map.get('body'), before);
		const restored = object(await codec.readDesktopPhotoCloneCurrentV1(structuredClone(wire))); assert.ok(restored.blob instanceof Blob); assert.equal(restored.blob.size, blob.size);
	} finally { codec.retireDesktopPhotoCloneCurrentV1(wire); }
});

void test('Desktop metadata refuses unbilled backing buffers before clone or native publisher acquisition', { timeout: 15_000 }, async () => {
	const wire = object(await codec.captureDesktopPhotoCloneCurrentV1(new Blob(['small'])));
	try {
		const changed = object(structuredClone(wire)); assert.ok(Array.isArray(changed.hosts)); const host = changed.hosts[0] as unknown[];
		host[6] = new Uint8Array(new ArrayBuffer(1024), 0, 5);
		assert.throws(() => measure(changed)); await assert.rejects(codec.readDesktopPhotoCloneCurrentV1(changed));
	} finally { codec.retireDesktopPhotoCloneCurrentV1(wire); }
});
