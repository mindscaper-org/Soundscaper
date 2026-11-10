/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseXmlDocument, type XmlElement } from '../src/common/editor/dawproject-xml.ts';
import { unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { loadVideoTimingAsset } from '../src/common/editor/video-timing-storage.ts';
import { reviewedCameraFiles, reviewedVideoReportCustody } from './helpers/reviewed-video-report-custody.ts';

function elements(element: XmlElement, name: string): readonly XmlElement[] {
	return [...(element.name === name ? [element] : []), ...element.children.flatMap(child => elements(child, name))];
}

for (const sequenceRate of [25, 30]) test(`actual FCPXML source25/sequence${sequenceRate} retains original camera bytes and persisted clock through Scape and file delivery`, async context => {
	const camera = reviewedCameraFiles[0]; assert.ok(camera);
	const fixture = await reviewedVideoReportCustody(context, [camera], { num: sequenceRate, den: 1 });
	const initial = await fixture.verifyMedia(fixture.controller.project);
	const source = initial.sources[0]; assert.ok(source?.kind === 'video');
	assert.equal(source.sourceFrameCount, 22); assert.equal(source.sampleFrameCount, 42_240);
	assert.deepEqual(source.frameRate, { num: 25, den: 1 }); assert.equal(source.width, 192); assert.equal(source.height, 144);
	const recipient = await fixture.reopen();
	const reopened = recipient.project.sources[0]; assert.ok(reopened?.kind === 'video');
	assert.deepEqual(recipient.project.sequences[0]?.rate, { num: sequenceRate, den: 1 });
	const clock = await loadVideoTimingAsset(recipient.environment.store, reopened.timingAsset, { sourceSha256: camera.sha256 });
	assert.equal(clock.status, 'available'); assert.equal(clock.index?.frameCount, 22);
	assert.equal(clock.index?.timescale, 12_800); assert.equal(clock.index?.presentationTicks[1], 512n);
	unregisterVideoTimingIndex(reopened);
	await recipient.controller.actions.export.exportFcpxml();
	const output = fixture.saved[0]; assert.ok(output); assert.match(output.name, /\.fcpxml$/u);
	const xml = parseXmlDocument(await output.text());
	const assets = elements(xml, 'asset'); assert.equal(assets.length, 1);
	const cameraFormat = assets[0]?.attributes.format; assert.ok(cameraFormat);
	const formats = new Map(elements(xml, 'format').map(format => [format.attributes.id, format.attributes]));
	assert.equal(formats.get(cameraFormat)?.frameDuration, '1/25s');
	assert.equal(formats.get(cameraFormat)?.width, '192'); assert.equal(formats.get(cameraFormat)?.height, '144');
	assert.equal(formats.get('r1')?.frameDuration, `1/${sequenceRate}s`);
	assert.equal(elements(xml, 'sequence')[0]?.attributes.format, 'r1');
	assert.equal(elements(xml, 'asset-clip').length, 1);
	assert.deepEqual(await fixture.verifyMedia(recipient.controller.project, recipient.environment.store), recipient.project);
});
