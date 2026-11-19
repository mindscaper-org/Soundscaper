/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFreesoundUploadMetadataDefaults } from '../src/common/editor/freesound-upload-metadata.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { aiffCommentMetadataCases, oversizedWavMetadataCase, pcmTextMetadataCases } from './helpers/pcm-metadata-import-cases.ts';

// Each variant enters the production import controller and production store,
// backed by a fixture IndexedDB API, before portable bytes reopen in a new store.
for (const fixture of [...await pcmTextMetadataCases(), ...aiffCommentMetadataCases(), oversizedWavMetadataCase()]) {
	test(`${fixture.file.name} retains its own tags and PCM through independent Scape reopening`, async context => {
		const { project, source, contribution, channels } = await importAndReopenAudio(context, fixture.file);
		assert.equal(source.sampleRate, fixture.expectedSampleRate);
		assert.equal(source.frameCount, fixture.expectedPcm[0]!.length);
		assert.equal(source.channelCount, fixture.expectedPcm.length);
		for (const [field, expected] of Object.entries(fixture.expectedTags)) {
			assert.deepEqual(contribution.metadata.normalized[field], expected, `${fixture.file.name}: ${field}`);
		}
		assertPcmChannelsEqual(channels, fixture.expectedPcm);
		if (fixture.truncated) assert.ok(contribution.warnings.some(warning => warning.includes('truncated')));
		if (fixture.artwork) {
			const pictures = contribution.attachments.filter(attachment => attachment.mimeType === 'image/png');
			assert.equal(pictures.length, 2);
			for (const picture of pictures) {
				assert.equal(picture.sha256, fixture.artwork.sha256);
				assert.equal(picture.byteLength, fixture.artwork.byteLength);
			}
		}
		if (fixture.sharingComment) {
			const defaults = createFreesoundUploadMetadataDefaults({ fileName: fixture.file.name, source });
			assert.ok(defaults.description.includes(`Comment: ${fixture.sharingComment}`));
		}
		if (fixture.expectedBextDescription) assert.equal(project.metadata.bext?.description, fixture.expectedBextDescription);
		if (fixture.expectedMarker) {
			assert.equal(project.metadata.ixml ?? null, null, 'oversized optional XML is omitted');
			assert.deepEqual(project.timelineAnnotations.map(annotation => ({
				name: annotation.name, positionFrame: annotation.anchor === 'sample' && annotation.kind === 'marker' ? annotation.positionFrame : null,
			})), [fixture.expectedMarker]);
		}
	});
}
