/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Page } from '@playwright/test';
import assert from 'node:assert/strict';
import type { Mp4TextMetadataCase } from '../../helpers/mp4-text-metadata-cases.ts';
import { strFromU8, unzipSync } from 'fflate';
import { parseScapeProjectDocument } from '../../../src/common/editor/scape-project-document.ts';
import { normalizeSourceProvenance } from '../../../src/common/editor/source-provenance.ts';
import { validateSoundscaperProject } from '../../../src/soundscaper/editor-project-validation.ts';
import { expect, test } from '../audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes } from '../audio-editor-test-helpers.js';

/** Keep native AAC admission/output for every container layout in one real picker/save workflow. */
export async function nativeMp4MetadataBatch(page: Page, cases: readonly Mp4TextMetadataCase[], compareNativePcm: boolean) {
	const caseTimeout = test.info().timeout;
	test.setTimeout(cases.length * caseTimeout);
	const fixtures = [];
	for (const fixture of cases) {
		const buffer = Buffer.from(await fixture.file.arrayBuffer());
		const reference = compareNativePcm ? await test.step(`native reference ${fixture.id}`, () => page.evaluate(async bytes => {
			const decoded = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(Uint8Array.from(bytes).buffer);
			return Array.from({ length: decoded.numberOfChannels }, (_, channel) => [...decoded.getChannelData(channel)]);
		}, [...buffer]), { timeout: caseTimeout }) : null;
		fixtures.push({ ...fixture, name: `Native-${fixture.id}.m4a`, buffer, reference });
	}
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(fixtures.map(fixture => ({ name: fixture.name, mimeType: fixture.file.type, buffer: fixture.buffer })));
	await expect(editor).toHaveAttribute('data-clip-count', String(fixtures.length), { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await downloading; let entries;
	try { entries = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
	const projectBytes = entries['project.json']; assert.ok(projectBytes);
	const project: unknown = parseScapeProjectDocument(strFromU8(projectBytes), { currentProjectSchemaFamily: 'soundscaper' });
	assert.ok(validateSoundscaperProject(project));
	expect(project.sources).toHaveLength(fixtures.length);
	for (const fixture of fixtures) {
		await test.step(`native admission and saved metadata ${fixture.id}`, async () => {
			const source = project.sources.find(source => source.name === fixture.name); assert.ok(source?.kind === 'audio');
			expect(source).toMatchObject({ channelCount: 2, sampleRate: 44_100 }); expect(source.frameCount).toBeGreaterThan(2000);
			const contribution = normalizeSourceProvenance(source.provenance).contributions[0]; assert.ok(contribution);
			expect(contribution.warnings).toEqual([]);
			for (const [key, value] of Object.entries(fixture.normalized)) expect(contribution.metadata.normalized[key]).toEqual(value);
			for (const [key, value] of Object.entries(fixture.raw)) expect(contribution.metadata.raw[key]).toEqual(value);
			if (fixture.reference) {
				expect(source.frameCount).toBe(fixture.reference[0]?.length); expect(source.channelCount).toBe(fixture.reference.length);
				const pcmBytes = entries[`audio/${source.id}.f32c`]; assert.ok(pcmBytes);
				const pcm = Buffer.from(pcmBytes); let maximumError = 0;
				for (let channel = 0; channel < fixture.reference.length; channel++) for (let frame = 0; frame < source.frameCount; frame++) {
					maximumError = Math.max(maximumError, Math.abs(pcm.readFloatLE(4 + (channel * source.frameCount + frame) * 4) - fixture.reference[channel]![frame]!));
				}
				expect(maximumError).toBeLessThan(1e-6);
			}
		}, { timeout: caseTimeout });
	}
}
