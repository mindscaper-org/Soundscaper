/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { importFramescaperTimelineImagesTimelineImage as importImages } from '../src/framescaper/editor-image-import-coordinator-timeline-image.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import { applyFramescaperProjectCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z', 'base64');

const decode: NonNullable<Parameters<typeof importImages>[0]['decode']> = request => decodeFramescaperBrowserNativeImageV1({
	...request,
	open: async () => ({
		metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'regression' },
		decodeFrame: async () => ({ rgba: Uint8Array.of(0, 0, 0, 255), durationMicroseconds: null }),
		close() {},
	}),
});

async function importFiles(files: readonly File[]) {
	let id = 0;
	return importImages({
		project: createFramescaperProjectTimelineImage(PROFILE), files, sequenceStartFrame: 0,
		createId: prefix => `${prefix}-${++id}`, decode,
		publisher: { publish: async ({ project, command }) => applyFramescaperProjectCommandTimelineImage(PROFILE, project, command) },
	});
}

test('image import accepts JPEG marker fill bytes that the native browser decoder supports', async () => {
	const padded = Uint8Array.from([...JPEG.subarray(0, 2), 255, 255, ...JPEG.subarray(2)]);
	const result = await importFiles([new File([padded], 'photo.jpg', { type: 'image/jpeg' })]);
	assert.equal(result.files[0]?.status, 'imported');
});

test('image import accepts the short OS/2 v2 BMP header supported by the native browser decoder', async () => {
	const bytes = new Uint8Array(34);
	const view = new DataView(bytes.buffer);
	bytes.set([66, 77]); view.setUint32(2, bytes.length, true); view.setUint32(10, 30, true);
	view.setUint32(14, 16, true); view.setInt32(18, 1, true); view.setInt32(22, 1, true);
	view.setUint16(26, 1, true); view.setUint16(28, 24, true); bytes[32] = 255;
	const result = await importFiles([new File([bytes], 'legacy.bmp', { type: 'image/bmp' })]);
	assert.equal(result.files[0]?.status, 'imported');
});

test('an empty image does not prevent other selected images from importing', async () => {
	const result = await importFiles([new File([], 'empty.png'), new File([PNG], 'good.png')]);
	assert.deepEqual(result.files.map(({ status }) => status), ['failed', 'imported']);
});

test('same-named images retain their picker order when the later image fails decode', async () => {
	const result = await importFiles([new File([PNG], 'same.png'), new File(['broken'], 'same.png')]);
	assert.deepEqual(result.files.map(({ status }) => status), ['imported', 'failed']);
	assert.ok(result.files[0]?.sourceId);
	assert.equal(result.files[1]?.sourceId, null);
});
