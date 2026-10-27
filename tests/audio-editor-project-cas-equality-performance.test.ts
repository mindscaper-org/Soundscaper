/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	sameSerializedScapeProjectDocument,
	serializeScapeProjectDocument,
	type ScapeProjectDocumentOptions,
} from '../src/common/editor/scape-project-document.ts';
import { ProjectCompareAndSwapRepository } from '../src/common/editor/storage/project-compare-and-swap-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

function document(fields: Readonly<Record<string, unknown>> = {}) {
	return { schemaFamily: 'soundscaper', schemaVersion: 1, id: 'comparison', ...fields };
}

function assertSerializationParity(left: unknown, right: unknown, options?: ScapeProjectDocumentOptions) {
	const outcome = (operation: () => boolean) => {
		try { return { value: operation() }; }
		catch (error) {
			assert.ok(error instanceof Error);
			return { name: error.name, message: error.message };
		}
	};
	assert.deepEqual(
		outcome(() => sameSerializedScapeProjectDocument(left, right, options)),
		outcome(() => serializeScapeProjectDocument(left, options) === serializeScapeProjectDocument(right, options)),
	);
}

test('CAS comparison avoids reconstructing and stringifying full baseline projects', async () => {
	const clips = Array.from({ length: 500 }, (_, index) => createAudioClip({
		id: `clip-${String(index)}`, sourceId: 'source', timelineStartFrame: index * 48_000, durationFrames: 48_000,
	}));
	const initial = createSoundscaperProject({
		id: 'comparison-performance', clips,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: 48_000, sampleRate: 48_000, channelCount: 2 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: clips.map((clip) => clip.id) })],
	});
	const memory = getMemoryDatabase(`comparison-performance-${globalThis.crypto.randomUUID()}`);
	const port = { memory, database: async () => null };
	const repository = new ProjectCompareAndSwapRepository(new ProjectRepository(port, 2), port, 2);
	await repository.save(initial);
	const nativeStringify = JSON.stringify;
	let wholeProjectSerializations = 0;
	JSON.stringify = (value: unknown, replacer?: never, space?: string | number): string => {
		if (value && typeof value === 'object' && 'id' in value && value.id === initial.id) wholeProjectSerializations += 1;
		return nativeStringify(value, replacer, space);
	};
	let saved;
	try {
		saved = await repository.saveIfCurrent(initial, { ...initial, revision: 1, title: 'Edited' });
	} finally { JSON.stringify = nativeStringify; }
	assert.ok(saved);
	assert.equal(wholeProjectSerializations, 0);
	assert.equal(saved.title, 'Edited');
});

test('serialized equality keeps property order, omitted values and numeric normalization', () => {
	const cases: readonly (readonly [unknown, unknown])[] = [
		[document({ alpha: 1, beta: 2 }), document({ beta: 2, alpha: 1 })],
		[document({ alpha: undefined }), document()],
		[document({ alpha: () => 1 }), document()],
		[document({ alpha: Symbol('omitted') }), document()],
		[document({ alpha: NaN }), document({ alpha: null })],
		[document({ alpha: Infinity }), document({ alpha: null })],
		[document({ alpha: -Infinity }), document({ alpha: null })],
		[document({ alpha: -0 }), document({ alpha: 0 })],
		[document({ alpha: [undefined, Symbol('null'), () => 1] }), document({ alpha: [null, null, null] })],
		[document({ alpha: new Array<unknown>(2) }), document({ alpha: [null, null] })],
		[document({ alpha: ['\\"\n\t', '\ud800', '\udfff', 'é', '😀'] }), document({ alpha: ['\\"\n\t', '\ud800', '\udfff', 'é', '😀'] })],
		[document({ alpha: { 10: true, 2: false, '01': null } }), document({ alpha: { 2: false, 10: true, '01': null } })],
		[document({ alpha: Object.assign(Object.create(null) as object, { value: 1 }) }), document({ alpha: { value: 1 } })],
		[document({ alpha: [{ nested: 1 }, []] }), document({ alpha: [{ nested: 1 }, {}] })],
		[document({ alpha: 'trailing' }), document({ alpha: 'trailing difference' })],
	];
	for (const [left, right] of cases) assertSerializationParity(left, right);
});

test('binary comparisons preserve payload type, sliced bytes, traversal order and budgets', () => {
	const sliced = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
	for (const [left, right] of [
		[document({ binary: sliced }), document({ binary: new Uint8Array([1, 2]) })],
		[document({ binary: sliced }), document({ binary: new Uint8Array([1, 3]) })],
		[document({ binary: sliced }), document({ binary: new Uint8Array([1, 2]).buffer })],
		[document({ binary: new ArrayBuffer(0) }), document({ binary: new ArrayBuffer(0) })],
		[document({ binary: [sliced, sliced] }), document({ binary: [new Uint8Array([1, 2]), new Uint8Array([1, 2])] })],
	]) assertSerializationParity(left, right);
	for (const limits of [
		{ maximumPayloadBytes: 1 },
		{ maximumPayloadCount: 1 },
		{ maximumTotalPayloadBytes: 3 },
		{ maximumTraversalDepth: 1 },
		{ maximumTraversalNodes: 4 },
	]) {
		assertSerializationParity(document(), document({ binary: [sliced, sliced] }), { limits });
		assertSerializationParity(document({ binary: [sliced, sliced] }), document(), { limits });
	}
});

test('proxy integer keys keep detached JSON ordering without repeating source traversal', () => {
	const events: string[] = [];
	const reordered = (value: Record<string, unknown>, keys: readonly string[]) => new Proxy(value, {
		ownKeys: () => [...keys],
		getOwnPropertyDescriptor(target, key) {
			events.push(String(key));
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	const values = { 2: 'two', 10: 'ten', '4294967294': 'last index', '4294967295': 'ordinary', '01': 'ordinary' };
	const nested = reordered(values, ['10', '01', '4294967294', '2', '4294967295']);
	const root = reordered(document({ 2: 'two', 10: 'ten', nested }), ['schemaFamily', 'schemaVersion', 'id', '10', '2', 'nested']);
	// Non-integer keys retain their authored order even when integers move first.
	const canonicalNested = { 2: 'two', 10: 'ten', '4294967294': 'last index', '01': 'ordinary', '4294967295': 'ordinary' };
	const canonical = document({ 2: 'two', 10: 'ten', nested: canonicalNested });
	const expected = serializeScapeProjectDocument(root) === serializeScapeProjectDocument(canonical);
	const expectedEvents = events.splice(0);
	assert.equal(expected, true);
	assert.equal(sameSerializedScapeProjectDocument(root, canonical), expected);
	assert.deepEqual(events, expectedEvents);
});

test('a mismatch still validates the entire right document and preserves error priority', () => {
	const cycle: Record<string, unknown> = {};
	cycle.self = cycle;
	const invalidValues = [
		cycle, 1n, new Date(0), new Float32Array([1]),
		{ $soundscaperOpaqueBinary: {} }, Object.assign(Object.create({}) as object, { value: 1 }),
		Object.setPrototypeOf([1], Object.create(Array.prototype) as object),
	];
	for (const value of invalidValues) {
		assertSerializationParity(document({ early: 'left' }), document({ early: 'right', late: value }));
		assertSerializationParity(document({ early: value }), document({ late: 1n }));
	}
});

test('ordinary data retains numeric normalization, family options, and error priority', () => {
	assertSerializationParity(undefined, undefined);
	assertSerializationParity({ id: 'legacy', schemaVersion: 17, value: [undefined, NaN] }, { id: 'legacy', schemaVersion: 17, value: [null, null] });
	assertSerializationParity(document({ alpha: 1 }), document({ alpha: 1 }), { currentProjectSchemaFamily: 'framescaper' });
	const untouchedRight = new Proxy(document(), {
		getOwnPropertyDescriptor: () => { throw new Error('Right input must remain untouched'); },
	});
	assert.throws(() => sameSerializedScapeProjectDocument(document({ invalid: 1n }), untouchedRight), /BigInt/u);
});

test('generated nested documents retain serializer equality and error outcomes', () => {
	function generated(seed: number) {
		let state = seed;
		const next = () => { state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0; return state; };
		const value = (depth: number): unknown => {
			const choice = next() % (depth ? 13 : 10);
			switch (choice) {
				case 0: return null;
				case 1: return undefined;
				case 2: return next() % 2 === 0;
				case 3: return -0;
				case 4: return next() / 100;
				case 5: return NaN;
				case 6: return `quote"\\\n\ud800:${String(next())}`;
				case 7: return new Uint8Array([next() % 256, next() % 256]);
				case 8: return next() / 100;
				case 9: return 1n;
				case 10: return Array.from({ length: next() % 4 }, () => value(depth - 1));
				case 11: return Object.assign(new Array<unknown>(3), { 2: value(depth - 1) });
				default: return { first: value(depth - 1), 10: value(depth - 1), 2: value(depth - 1), last: value(depth - 1) };
			}
		};
		return document({ generated: value(3), last: 'complete' });
	}
	for (let seed = 1; seed <= 150; seed += 1) {
		assertSerializationParity(generated(seed), generated(seed));
		assertSerializationParity(generated(seed), generated(seed + 1));
	}
});

test('baseline traversal preserves shared-node visitation order', () => {
	const events: string[] = [];
	const observed = (side: string) => new Proxy({ value: 1 }, {
		getOwnPropertyDescriptor(target, key) {
			events.push(`${side}:${String(key)}`);
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	const left = document({ alpha: observed('left') });
	const right = document({ alpha: observed('right') });
	const expected = serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
	const expectedEvents = events.splice(0);
	assert.equal(sameSerializedScapeProjectDocument(left, right), expected);
	assert.deepEqual(events, expectedEvents);
});
