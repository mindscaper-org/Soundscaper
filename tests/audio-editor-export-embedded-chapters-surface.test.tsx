/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { elementByTag, mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';
import { reactProps } from './helpers/react-test-dom.ts';

test('embedded chapters are opt-in for supported mixed files and hidden for other deliveries', async () => {
	const fixture = await mountedExportDialog();
	try {
		assert.equal(fixture.dom.find('[data-export-field="embedLabelChapters"]'), null);
		await fixture.chooseFormat('MP3');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-checked'), 'false');
		await fixture.click(fixture.chapterCheckbox());
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.embedLabelChapters, true);
		await fixture.chooseFormat('AAC / M4A');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-checked'), 'true');
		await fixture.chooseOutput(ENGLISH_COPY.exportOutputStems);
		assert.equal(fixture.dom.find('[data-export-field="embedLabelChapters"]'), null);
		await fixture.startExport();
		assert.equal(Object.hasOwn(fixture.requests[1] ?? {}, 'embedLabelChapters'), false);
		await fixture.chooseOutput(ENGLISH_COPY.exportOutputClips);
		assert.equal(fixture.dom.find('[data-export-field="embedLabelChapters"]'), null);
		await fixture.startExport();
		assert.equal(Object.hasOwn(fixture.requests[2] ?? {}, 'embedLabelChapters'), false);
		await fixture.chooseOutput(ENGLISH_COPY.entireProject);
		await fixture.chooseFormat('WAV');
		assert.equal(fixture.dom.find('[data-export-field="embedLabelChapters"]'), null);
		await fixture.startExport();
		assert.equal(Object.hasOwn(fixture.requests[3] ?? {}, 'embedLabelChapters'), false);
	} finally {
		await fixture.unmount();
	}
});

test('embedded chapters explain when the project needs a label', async () => {
	const fixture = await mountedExportDialog({ labels: [] });
	try {
		await fixture.chooseFormat('MP3');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
		assert.equal(fixture.dom.one('[data-export-chapters-hint]').textContent, ENGLISH_COPY.embedLabelChaptersNoLabels);
	} finally {
		await fixture.unmount();
	}
});

test('downsampled region labels that collapse in the encoder stay unavailable in the dialog', async () => {
	const fixture = await mountedExportDialog({
		sampleRate: 96_000,
		labels: [{ id: 'short', title: 'Short region', startFrame: 2, endFrame: 3 }],
		selection: { startFrame: 0, endFrame: 4 },
	});
	try {
		await fixture.chooseFormat('MP3');
		const rate = elementByTag(fixture.dom.one('[data-export-field="sampleRate"]'), 'input');
		await act(async () => { reactProps(rate).onChange({ currentTarget: { value: '32000' } }); });
		await fixture.chooseOutput(ENGLISH_COPY.currentSelection);
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
	} finally {
		await fixture.unmount();
	}
});
