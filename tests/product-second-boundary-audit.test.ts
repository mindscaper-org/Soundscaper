/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertFramescaperDesktopPublicationBodyInventory,
	createFramescaperDesktopPublicationId,
	validateFramescaperDesktopPublicationAdmission,
} from '../src/framescaper/desktop-project-library-publication-admission.ts';
import {
	framescaperNativeImageSequenceActionBridgeAvailableNativeMedia as imageSequenceBridgeAvailable,
	framescaperNativeOpenFxActionBridgeAvailableNativeMedia as openFxBridgeAvailable,
} from '../src/framescaper/editor-native-action-bridge-availability.ts';
import {
	dataArray,
	exactRecordById,
	nonNegativeInteger,
	positiveInteger,
	safeAdd,
	stableId,
	throwIfAborted,
} from '../src/soundscaper/editor-audio-track-freeze-values.ts';

const PUBLICATION_ID = 'ab'.repeat(24);
const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const IMAGE_SEQUENCE_METHODS = Object.freeze([
	'capabilities', 'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
	'imageSequenceImport', 'writeImageSequenceImportChunk', 'readImageSequenceImportBody',
] as const);

function publicationAdmission(requiredBodyIndexes: unknown, bodyCount = 3): Record<string, unknown> {
	return {
		publicationId: PUBLICATION_ID,
		maximumChunkBytes: MAXIMUM_CHUNK_BYTES,
		bodyCount,
		requiredBodyIndexes,
	};
}

function imageSequenceBridge(): Record<string, unknown> {
	return Object.fromEntries(IMAGE_SEQUENCE_METHODS.map((method) => [method, () => undefined]));
}

function openFxBridge(): Record<string, unknown> {
	return { capabilities: () => undefined, listOpenFxPlugins: () => undefined };
}

test('freeze record lookup returns the one record with an own stable identity', () => {
	const target = Object.assign(Object.create(null) as Record<string, unknown>, {
		id: 'target', value: 7,
	});
	assert.equal(exactRecordById([{ id: 'other' }, target], 'target', 'freeze item'), target);
});

test('freeze record lookup rejects an absent identity', () => {
	assert.throws(
		() => exactRecordById([{ id: 'other' }], 'target', 'freeze item'),
		/freeze item target must exist exactly once/u,
	);
});

test('freeze data arrays snapshot dense plain and null-prototype records', () => {
	const first = { id: 'first' };
	const second = Object.assign(Object.create(null) as Record<string, unknown>, { id: 'second' });
	const result = dataArray([first, second], 'freeze values');
	assert.deepEqual(result, [first, second]);
	assert.equal(Object.isFrozen(result), true);
});

test('freeze scalar validators enforce stable IDs and canonical safe integers', () => {
	assert.equal(stableId('track-a', 'track'), 'track-a');
	assert.throws(() => stableId('', 'track'), /nonempty/u);
	assert.equal(nonNegativeInteger(0, 'start'), 0);
	assert.throws(() => nonNegativeInteger(-0, 'start'), /nonnegative/u);
	assert.throws(() => nonNegativeInteger(0.5, 'start'), /nonnegative/u);
	assert.equal(positiveInteger(1, 'frames'), 1);
	assert.throws(() => positiveInteger(0, 'frames'), /positive/u);
});

test('freeze safe addition validates each operand before accepting its sum', () => {
	assert.equal(safeAdd(4, 5, 'range'), 9);
	assert.throws(() => safeAdd(0.5, 0.5, 'range'), /operands/u);
	assert.throws(() => safeAdd(-1, 2, 'range'), /operands/u);
	assert.throws(() => safeAdd(-0, 1, 'range'), /operands/u);
	assert.throws(() => safeAdd(Number.MAX_SAFE_INTEGER, 1, 'range'), /safe frame range/u);
});

test('freeze abort checks preserve the caller reason', () => {
	assert.doesNotThrow(() => throwIfAborted());
	assert.doesNotThrow(() => throwIfAborted(new AbortController().signal));
	const reason = new Error('stop');
	assert.throws(() => throwIfAborted(AbortSignal.abort(reason)), (error) => error === reason);
});

test('OpenFX bridge availability rejects prototype-provided methods', () => {
	assert.equal(openFxBridgeAvailable(Object.create(openFxBridge())), false);
});

test('OpenFX bridge availability does not invoke own accessors', () => {
	let reads = 0;
	const bridge = openFxBridge();
	Object.defineProperty(bridge, 'capabilities', {
		enumerable: true,
		get: () => {
			reads += 1;
			return () => undefined;
		},
	});
	assert.equal(openFxBridgeAvailable(bridge), false);
	assert.equal(reads, 0);
});

test('image-sequence bridge availability rejects prototype-provided methods', () => {
	assert.equal(imageSequenceBridgeAvailable(Object.create(imageSequenceBridge())), false);
});

test('image-sequence bridge availability does not invoke own accessors', () => {
	let reads = 0;
	const bridge = imageSequenceBridge();
	Object.defineProperty(bridge, 'readImageSequenceFile', {
		enumerable: true,
		get: () => {
			reads += 1;
			return () => undefined;
		},
	});
	assert.equal(imageSequenceBridgeAvailable(bridge), false);
	assert.equal(reads, 0);
});

test('native bridge availability converts hostile reflection failures to false', () => {
	const hostile = new Proxy(openFxBridge(), {
		getOwnPropertyDescriptor: () => {
			throw new Error('hostile descriptor');
		},
	});
	assert.equal(openFxBridgeAvailable(hostile), false);
	const revoked = Proxy.revocable(openFxBridge(), {});
	revoked.revoke();
	assert.equal(openFxBridgeAvailable(revoked.proxy), false);
});

test('native bridge availability accepts null-prototype own function surfaces', () => {
	const openFx = Object.assign(Object.create(null) as Record<string, unknown>, openFxBridge());
	const imageSequence = Object.assign(
		Object.create(null) as Record<string, unknown>, imageSequenceBridge(),
	);
	assert.equal(openFxBridgeAvailable(openFx), true);
	assert.equal(imageSequenceBridgeAvailable(imageSequence), true);
});

test('desktop publication identities are fresh 192-bit lowercase hex values', () => {
	const first = createFramescaperDesktopPublicationId();
	const second = createFramescaperDesktopPublicationId();
	assert.match(first, /^[a-f0-9]{48}$/u);
	assert.match(second, /^[a-f0-9]{48}$/u);
	assert.notEqual(first, second);
});

test('desktop publication admission returns a detached frozen index snapshot', () => {
	const indexes = [0, 2];
	const result = validateFramescaperDesktopPublicationAdmission(
		publicationAdmission(indexes), PUBLICATION_ID, 3,
	);
	indexes[0] = 1;
	assert.deepEqual(result.requiredBodyIndexes, [0, 2]);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.requiredBodyIndexes), true);
});

test('desktop publication admission requires dense own-data body indexes', () => {
	assert.throws(
		() => validateFramescaperDesktopPublicationAdmission(
			publicationAdmission([0, 1], 1), PUBLICATION_ID, 1,
		),
		/bounded dense array/u,
	);
	const sparse: unknown[] = [];
	sparse.length = 1;
	assert.throws(
		() => validateFramescaperDesktopPublicationAdmission(
			publicationAdmission(sparse, 1), PUBLICATION_ID, 1,
		),
		/bounded dense array/u,
	);
	let reads = 0;
	const accessor: unknown[] = [];
	Object.defineProperty(accessor, '0', {
		enumerable: true,
		get: () => {
			reads += 1;
			return 0;
		},
	});
	assert.throws(
		() => validateFramescaperDesktopPublicationAdmission(
			publicationAdmission(accessor, 1), PUBLICATION_ID, 1,
		),
		/own data property/u,
	);
	assert.equal(reads, 0);
});

test('desktop publication admission requires canonical increasing bounded indexes', () => {
	for (const indexes of [[0, 0], [1, 0], [2], [0.5], [-0]]) {
		assert.throws(
			() => validateFramescaperDesktopPublicationAdmission(
				publicationAdmission(indexes, 2), PUBLICATION_ID, 2,
			),
			/required publication body indexes changed/u,
		);
	}
});

test('desktop publication inventory comparison ignores plain-record insertion order', () => {
	const admitted = [{ descriptor: { kind: 'body', nested: { alpha: 1, beta: true }, byteLength: 4 } }];
	const prepared = [{ descriptor: { byteLength: 4, nested: { beta: true, alpha: 1 }, kind: 'body' } }];
	assert.doesNotThrow(() => assertFramescaperDesktopPublicationBodyInventory(admitted, prepared));
	const shared = { stable: true };
	const repeated = [{ descriptor: { first: shared, second: shared } }];
	assert.doesNotThrow(() => assertFramescaperDesktopPublicationBodyInventory(repeated, repeated));
});

test('desktop publication inventory rejects lossy or executable descriptor differences', () => {
	assert.throws(
		() => assertFramescaperDesktopPublicationBodyInventory(
			[{ descriptor: { omitted: undefined } }], [{ descriptor: {} }],
		),
		/inventory changed after admission/u,
	);
	assert.throws(
		() => assertFramescaperDesktopPublicationBodyInventory(
			[{ descriptor: { value: Number.NaN } }], [{ descriptor: { value: null } }],
		),
		/inventory changed after admission/u,
	);
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	assert.throws(
		() => assertFramescaperDesktopPublicationBodyInventory(
			[{ descriptor: cyclic }], [{ descriptor: cyclic }],
		),
		/inventory changed after admission/u,
	);
	let reads = 0;
	const executable: Record<string, unknown> = {};
	Object.defineProperty(executable, 'descriptor', {
		enumerable: true,
		get: () => {
			reads += 1;
			return {};
		},
	});
	assert.throws(
		() => assertFramescaperDesktopPublicationBodyInventory(
			[executable as Readonly<{ descriptor: unknown }>], [{ descriptor: {} }],
		),
		/inventory changed after admission/u,
	);
	assert.equal(reads, 0);
});
