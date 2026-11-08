/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importCaptionInterchangeV1, exportCaptionInterchangeV1 } from '../src/common/editor/video-caption-interchange-v27.ts';
import { normalizeVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { withFramescaperSidecarFile } from '../src/common/editor/ui/framescaper-sidecar-file.ts';
import { parseCubeLutV1 } from '../src/common/imaging/cube-lut-v1.ts';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';

const SUBRIP = '1\n00:00:00,100 --> 00:00:00,500\nA normal caption\n\n';

test('the Caption Tracks file owner reads a normal native SRT in its actual selected-range lease', async (context) => {
	const fixture = await nativeSidecarFixture('dialogue.srt', SUBRIP);
	context.after(fixture.close);
	const service = createAudioEditorFileService({ bridge: fixture.bridge, fetch: fixture.fetch });
	assert.deepEqual(await openFramescaperCaptionSidecarFile({ fileService: service }), {
		format: 'srt', fileName: 'dialogue.srt', text: SUBRIP,
	});
	assert.equal(fixture.releases.length, 1);
});

test('the normal browser SRT file control reads the same dialogue', async () => {
	assert.deepEqual(await openFramescaperCaptionSidecarFile({ file: new File([SUBRIP], 'dialogue.srt') }), {
		format: 'srt', fileName: 'dialogue.srt', text: SUBRIP,
	});
});

test('the shared finishing reader retains a native cube LUT lease until its consumer finishes', async (context) => {
	const text = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
	const fixture = await nativeSidecarFixture('identity.cube', text);
	context.after(fixture.close);
	const service = createAudioEditorFileService({ bridge: fixture.bridge, fetch: fixture.fetch });
	const descriptors = await service.chooseFiles({ purpose: 'lut', multiple: false });
	const parsed = await withFramescaperSidecarFile(service, descriptors[0], undefined, async (file) => {
		assert.equal(fixture.releases.length, 0);
		const body = await file.text();
		await Promise.resolve();
		assert.equal(await file.slice(0, 14).text(), 'LUT_3D_SIZE 2\n');
		assert.equal(fixture.releases.length, 0);
		return parseCubeLutV1(body);
	});
	assert.equal(parsed.size, 2);
	assert.equal(fixture.releases.length, 1);
});

for (const desktop of [false, true]) test(`the ${desktop ? 'native' : 'browser'} caption read reaches the canonical cue document and exports unchanged`, async context => {
	const native = desktop ? await nativeSidecarFixture('dialogue.srt', SUBRIP) : null;
	if (native) context.after(native.close);
	const sidecar = await openFramescaperCaptionSidecarFile(native
		? { fileService: createAudioEditorFileService({ bridge: native.bridge, fetch: native.fetch }) }
		: { file: new File([SUBRIP], 'dialogue.srt', { type: 'application/x-subrip' }) }); assert.ok(sidecar);
	const imported = importCaptionInterchangeV1(sidecar.text, { format: sidecar.format, sampleRate: 48_000,
		trackId: 'captions', sequenceId: 'main', trackName: 'Dialogue', language: 'en' }, normalizeVideoCaptionTrackV1);
	assert.deepEqual(imported.losses, []); assert.equal(imported.track.cues.length, 1);
	const cue = imported.track.cues[0]; assert.ok(cue);
	assert.equal(cue.startFrame, 4800); assert.equal(cue.endFrame, 24000);
	assert.equal(cue.text, 'A normal caption');
	const exported = exportCaptionInterchangeV1(imported.track, { format: 'srt', sampleRate: 48_000 });
	assert.deepEqual(exported.losses.map(loss => loss.code), ['track-metadata-omitted', 'cue-identity-omitted']);
	assert.equal(exported.text, SUBRIP.trimEnd() + '\n');
	if (native) assert.equal(native.releases.length, 1);
});
