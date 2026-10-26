/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	planScapeVideoProxyArchiveAssets,
	type ScapeVideoProxyArchiveAssetDescriptor,
	type ScapeVideoProxyArchiveReference,
} from '../src/common/editor/scape-video-proxy-archive-plan.ts';
import { SCAPE_FORMAT_VERSION } from '../src/common/editor/scape-archive-envelope.ts';
import {
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_HEADER_BYTES,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset-reference.ts';

const PROXY_SHA = 'a'.repeat(64);
const TIMING_SHA = 'b'.repeat(64);
const FRAME_COUNT = 3;
const TIMING_BYTES = VIDEO_TIMING_ASSET_HEADER_BYTES + FRAME_COUNT * 8;

type MutableRecord = Record<PropertyKey, unknown>;


test('keeps proxy and timing attachments in the unified format 1', () => {
	assert.equal(SCAPE_FORMAT_VERSION, 1);
	const empty = planScapeVideoProxyArchiveAssets([]);
	assert.deepEqual(empty, { formatVersion: 1, assets: [] });
	assert.equal(Object.isFrozen(empty), true);
	assert.equal(Object.isFrozen(empty.assets), true);

	const input = reference();
	const plan = planScapeVideoProxyArchiveAssets([input]);
	assert.equal(plan.formatVersion, 1);
	assert.deepEqual(plan.assets, [proxyDescriptor(), timingDescriptor()]);
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.assets), true);
	assert.equal(planScapeVideoProxyArchiveAssets([reference({ byteLength: 512 * 1024 * 1024 + 1 })]).assets[0]?.size, 512 * 1024 * 1024 + 1);
	assert.ok(plan.assets.every((asset) => Object.isFrozen(asset)));
	assert.notEqual(plan.assets[0], input);
	assert.deepEqual(Object.keys(plan.assets[0]!), DESCRIPTOR_FIELDS);
	assert.deepEqual(Object.keys(plan.assets[1]!), DESCRIPTOR_FIELDS);

	(input as unknown as MutableRecord).mimeType = 'video/webm';
	(input.timingAsset as unknown as MutableRecord).timescale = 90_000;
	assert.deepEqual(plan.assets, [proxyDescriptor(), timingDescriptor()]);
});

test('deduplicates exact bodies and permits shared timing while rejecting conflicting identities', () => {
	assert.deepEqual(planScapeVideoProxyArchiveAssets([reference(), reference()]).assets,
		[proxyDescriptor(), timingDescriptor()]);

	const secondSha = `c${'0'.repeat(63)}`;
	const sharedTiming = reference({
		storageKey: `video-proxy-sha256:${secondSha}`,
		sha256: secondSha,
		mimeType: 'video/webm',
		timingAsset: timing({ sourceSha256: secondSha }),
	});
	assert.deepEqual(planScapeVideoProxyArchiveAssets([reference(), sharedTiming]).assets, [
		proxyDescriptor(),
		timingDescriptor(),
		proxyDescriptor({
			sourceId: `video-proxy-sha256:${secondSha}`,
			entry: `proxy/${secondSha}/body`,
			mimeType: 'video/webm',
			sha256: secondSha,
		}),
	]);

	for (const conflict of [
		reference({ byteLength: 124 }),
		reference({ mimeType: 'video/webm' }),
		reference({ timingAsset: timing({ timescale: 90_000 }) }),
	]) assert.throws(
		() => planScapeVideoProxyArchiveAssets([reference(), conflict]),
		/conflict/iu,
	);
});


test('refuses open, sparse, accessor, exotic, and malformed reference input', () => {
	class References extends Array<unknown> {}
	const sparse = Array(1);
	const extra = [reference()] as unknown[] & { extra?: boolean };
	extra.extra = true;
	const symbol = [reference()] as unknown as MutableRecord;
	symbol[Symbol('extra')] = true;
	for (const value of [
		null, undefined, false, 1, 'references', {}, new References(), sparse, extra, symbol,
	]) assert.throws(() => planScapeVideoProxyArchiveAssets(value), TypeError);

	for (const [fields, make, consume] of [
		[REFERENCE_FIELDS, reference, (value: object) => planScapeVideoProxyArchiveAssets([value])],
		[TIMING_FIELDS, timing, (value: object) => planScapeVideoProxyArchiveAssets([
			reference({ timingAsset: value }),
		])],
	] as const) for (const field of fields) {
		const missing = make() as unknown as MutableRecord;
		delete missing[field];
		assert.throws(() => consume(missing), TypeError);
		const hidden = make() as unknown as MutableRecord;
		Object.defineProperty(hidden, field, { value: hidden[field], enumerable: false });
		assert.throws(() => consume(hidden), TypeError);
		let gets = 0;
		const accessor = make() as unknown as MutableRecord;
		Object.defineProperty(accessor, field, { enumerable: true,
			get() { gets += 1; return (make() as unknown as MutableRecord)[field]; } });
		assert.throws(() => consume(accessor), TypeError);
		assert.equal(gets, 0);
	}
});


test('enforces proxy identity, body bounds, timing binding, and the archive entry budget', () => {
	for (const invalid of [
		reference({ storageKey: `video-proxy-sha256:${'d'.repeat(64)}` }),
		reference({ sha256: PROXY_SHA.toUpperCase() }),
		reference({ mimeType: 'audio/mp4' }),
		reference({ mimeType: 'video/mp4;codecs=h264' }),
		reference({ byteLength: 0 }),
		reference({ byteLength: Number.MAX_SAFE_INTEGER + 1 }),
		reference({ timingAsset: timing({ sourceSha256: 'd'.repeat(64) }) }),
	]) assert.throws(() => planScapeVideoProxyArchiveAssets([invalid]), /proxy|timing|digest|MIME|byte|bind/iu);

	const references = Array.from({ length: 2_048 }, (_, index) => {
		const suffix = index.toString(16).padStart(64, '0');
		const timingSuffix = (index + 2_048).toString(16).padStart(64, '0');
		return reference({
			storageKey: `video-proxy-sha256:${suffix}`,
			sha256: suffix,
			timingAsset: timing({
				storageKey: `video-timing-sha256:${timingSuffix}`,
				sha256: timingSuffix,
				sourceSha256: suffix,
			}),
		});
	});
	assert.equal(planScapeVideoProxyArchiveAssets(references.slice(0, 2_047)).assets.length, 4_094);
	assert.throws(() => planScapeVideoProxyArchiveAssets(references), /entry|asset|limit|many/iu);
});


const REFERENCE_FIELDS = ['storageKey', 'mimeType', 'byteLength', 'sha256', 'timingAsset'] as const;
const TIMING_FIELDS = [
	'encoding', 'storageKey', 'sha256', 'sourceSha256', 'byteLength', 'frameCount',
	'timescale', 'finalFrameDurationTicks',
] as const;
const DESCRIPTOR_FIELDS = ['sourceId', 'kind', 'encoding', 'entry', 'mimeType', 'size', 'sha256'];

function reference(
	overrides: Readonly<Record<string, unknown>> = {},
): ScapeVideoProxyArchiveReference {
	return {
		storageKey: `video-proxy-sha256:${PROXY_SHA}`,
		mimeType: 'video/mp4',
		byteLength: 123,
		sha256: PROXY_SHA,
		timingAsset: timing(),
		...overrides,
	} as ScapeVideoProxyArchiveReference;
}

function timing(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: `video-timing-sha256:${TIMING_SHA}`,
		sha256: TIMING_SHA,
		sourceSha256: PROXY_SHA,
		byteLength: TIMING_BYTES,
		frameCount: FRAME_COUNT,
		timescale: 1_000,
		finalFrameDurationTicks: '40',
		...overrides,
	};
}

function proxyDescriptor(
	overrides: Partial<ScapeVideoProxyArchiveAssetDescriptor> = {},
): ScapeVideoProxyArchiveAssetDescriptor {
	return {
		sourceId: `video-proxy-sha256:${PROXY_SHA}`,
		kind: 'video-proxy',
		encoding: 'video-proxy-v1',
		entry: `proxy/${PROXY_SHA}/body`,
		mimeType: 'video/mp4',
		size: 123,
		sha256: PROXY_SHA,
		...overrides,
	};
}

function timingDescriptor(): ScapeVideoProxyArchiveAssetDescriptor {
	return {
		sourceId: `video-timing-sha256:${TIMING_SHA}`,
		kind: 'video-timing',
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		entry: `timing/${TIMING_SHA}.scti`,
		mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		size: TIMING_BYTES,
		sha256: TIMING_SHA,
	};
}
