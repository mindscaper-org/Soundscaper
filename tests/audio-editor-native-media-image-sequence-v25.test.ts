/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeMediaImageSequenceInventoryV25,
	createNativeMediaImageSequenceSourceV25,
	nativeMediaImageSequenceArchiveRootsV25,
	nativeMediaImageSequenceDecodeRequestV25,
	normalizeNativeMediaImageSequenceSourceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import { resolveNativeMediaImageSequence } from '../src/common/editor/native-media-image-sequence.ts';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';

const DIGESTS = ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)] as const;

test('V25 project JSON stores compact digest-bound inventory and pack references', () => {
	const selection = resolveNativeMediaImageSequence({
		fileNames: ['shot_010.exr', 'shot_008.exr', 'shot_009.exr'],
		frameRate: { num: 24_000, den: 1_001 },
	});
	const publication = createNativeMediaImageSequenceInventoryV25(selection, [
		entry('shot_008.exr', 8, DIGESTS[0]),
		entry('shot_009.exr', 9, DIGESTS[1]),
		entry('shot_010.exr', 10, DIGESTS[2]),
	]);
	const source = createNativeMediaImageSequenceSourceV25({
		id: 'source-sequence-1',
		name: 'Shot 8-10',
		selection,
		inventory: publication.reference,
		sourcePack: pack('aa'.repeat(32), 12_345),
		characteristics: createUnreportedVideoSourceCharacteristicsV25(),
	});

	assert.equal(source.sourceType, 'image-sequence');
	assert.equal(source.frameCount, 3);
	assert.deepEqual(source.frameRate, { num: 24_000, den: 1_001 });
	assert.equal(JSON.stringify(source).includes('shot_008.exr'), false);
	assert.equal(Object.hasOwn(source, 'frames'), false);
	assert.ok(publication.bytes.length > 0, 'per-frame inventory stays in its external asset');
	assert.deepEqual(nativeMediaImageSequenceArchiveRootsV25(source), [
		publication.reference.storageKey,
		source.sourcePack.storageKey,
	]);
	assert.deepEqual(nativeMediaImageSequenceDecodeRequestV25(source), {
		kind: 'native-image-sequence-decode-v1',
		profileId: 'decode-openexr-sequence',
		pattern: 'shot_%03d.exr',
		firstFrameNumber: 8,
		frameCount: 3,
		frameRate: { num: 24_000, den: 1_001 },
		inventory: publication.reference,
		sourcePack: source.sourcePack,
	});
});

test('inventory identity binds canonical numeric order and every selected file', () => {
	const selection = resolveNativeMediaImageSequence({
		fileNames: ['f_002.png', 'f_001.png'], frameRate: { num: 25, den: 1 },
	});
	assert.throws(() => createNativeMediaImageSequenceInventoryV25(selection, [
		entry('f_002.png', 2, DIGESTS[1]), entry('f_001.png', 1, DIGESTS[0]),
	]), /canonical numeric order/u);
	assert.throws(() => createNativeMediaImageSequenceInventoryV25(selection, [
		entry('f_001.png', 1, DIGESTS[0]),
	]), /exact selected file inventory/u);
});

test('pending still-format licensing review does not block source authoring for testing', () => {
	const selection = resolveNativeMediaImageSequence({
		fileNames: ['f_001.tif'], frameRate: { num: 25, den: 1 },
	});
	const inventory = createNativeMediaImageSequenceInventoryV25(selection, [
		entry('f_001.tif', 1, DIGESTS[0]),
	]);
	const source = createNativeMediaImageSequenceSourceV25({
		id: 'testable-source', name: 'Testable', selection,
		inventory: inventory.reference, sourcePack: pack('aa'.repeat(32), 1_000),
		characteristics: createUnreportedVideoSourceCharacteristicsV25(),
	});
	assert.equal(source.id, 'testable-source');
	assert.equal(nativeMediaImageSequenceDecodeRequestV25(source).profileId, 'decode-tiff-sequence');
});

test('closed source validation rejects reference substitution and embedded frame records', () => {
	const source = fixtureSource();
	assert.throws(() => normalizeNativeMediaImageSequenceSourceV25({
		...source,
		inventory: { ...source.inventory, storageKey: 'image-sequence-inventory-sha256:' + 'ef'.repeat(32) },
	}), /storage key does not match its digest/u);
	assert.throws(() => normalizeNativeMediaImageSequenceSourceV25({
		...source,
		frames: [{ fileName: 'smuggled.png' }],
	}), /unsupported.*frames/u);
});

function fixtureSource() {
	const selection = resolveNativeMediaImageSequence({
		fileNames: ['f_001.png'], frameRate: { num: 25, den: 1 },
	});
	const inventory = createNativeMediaImageSequenceInventoryV25(selection, [
		entry('f_001.png', 1, DIGESTS[0]),
	]);
	return createNativeMediaImageSequenceSourceV25({
		id: 'source', name: 'Source', selection,
		inventory: inventory.reference, sourcePack: pack('aa'.repeat(32), 1_000),
		characteristics: createUnreportedVideoSourceCharacteristicsV25(),
	});
}

function entry(fileName: string, frameNumber: number, sha256: string) {
	return { fileName, frameNumber, byteLength: 100 + frameNumber, sha256 };
}

function pack(sha256: string, byteLength: number) {
	return {
		kind: 'image-sequence-source-pack' as const,
		storageKey: `image-sequence-pack-sha256:${sha256}`,
		sha256,
		byteLength,
	};
}
