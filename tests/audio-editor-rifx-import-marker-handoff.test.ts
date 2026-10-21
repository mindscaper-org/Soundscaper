/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { commandOfType, createFixture } from './audio-editor-project-import-service-fixture.ts';
import { createProjectImportService } from './helpers/project-import-runtime-fixture.ts';
import { libsndfileRifxSamples } from './helpers/libsndfile-rifx-fixture.ts';

const encoder = new TextEncoder();
function chunk(id: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(8 + body.length + body.length % 2);
	bytes.set(encoder.encode(id));
	new DataView(bytes.buffer).setUint32(4, body.length, false);
	bytes.set(body, 8);
	return bytes;
}
function markedRifx(codePage = 0): File {
	const original = libsndfileRifxSamples('s16');
	const cue = new Uint8Array(28);
	const cueView = new DataView(cue.buffer);
	cueView.setUint32(0, 1, false);
	cueView.setUint32(4, 7, false);
	cue.set(encoder.encode('data'), 12);
	cueView.setUint32(24, 1, false);
	const region = new Uint8Array(20 + 7);
	const regionView = new DataView(region.buffer);
	regionView.setUint32(0, 7, false);
	regionView.setUint32(4, 2, false);
	regionView.setUint16(18, codePage, false);
	region.set(encoder.encode('Pickup\0'), 20);
	const ltxt = chunk('ltxt', region);
	const list = new Uint8Array(4 + ltxt.length);
	list.set(encoder.encode('adtl'));
	list.set(ltxt, 4);
	const cueChunk = chunk('cue ', cue), listChunk = chunk('LIST', list);
	const combined = new Uint8Array(original.length + cueChunk.length + listChunk.length);
	combined.set(original);
	combined.set(cueChunk, original.length);
	combined.set(listChunk, original.length + cueChunk.length);
	new DataView(combined.buffer).setUint32(4, combined.length - 8, false);
	return new File([combined], 'big-endian.wav', { type: 'audio/wav' });
}

for (const codePage of [0, 866]) {
	test(`controller RIFX streaming import retains big-endian region annotations and reports text loss (${String(codePage)})`, async () => {
		const fixture = createFixture();
		fixture.setProject(createCurrentAudioEditorProject({ id: 'rifx-markers', sampleRate: 48_000 }) as unknown as Record<string, unknown>);
		const service = createProjectImportService(fixture.runtime);
		const result = await service.importFile(markedRifx(codePage));
		assert.equal(result.destination, 'timeline');
		const added = commandOfType(fixture.commands[0]?.command, 'timeline-annotation/add') as {
			annotation?: { kind?: string; positionFrame?: number; startFrame?: number; endFrame?: number; name?: string };
		} | undefined;
		assert.ok(added, 'the UI import route must retain its RIFX region annotation');
		assert.equal(added.annotation?.kind, 'region');
		assert.equal(added.annotation?.startFrame, 1);
		assert.equal(added.annotation?.endFrame, 3);
		if (codePage === 0) assert.equal(added.annotation?.name, 'Pickup');
		else assert.match(result.notice, /866/u);
	});
}
