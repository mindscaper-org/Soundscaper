/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeIxmlPayload } from '../src/common/editor/ixml.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { prepareImportedWavMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { freezeProjectImportOptions, normalizeProjectImportOptions } from '../src/common/editor/controller/import/internal/project-import-options.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

// Gallery's recorder format: https://www.gallery.co.uk/ixml/iXML_Example.html
const xml = '<BWFXML><IXML_VERSION>1.52</IXML_VERSION><SYNC_POINT_LIST><SYNC_POINT_COUNT>2</SYNC_POINT_COUNT>'
	+ '<SYNC_POINT><SYNC_POINT_TYPE>RELATIVE</SYNC_POINT_TYPE><SYNC_POINT_FUNCTION>SLATE_GENERIC</SYNC_POINT_FUNCTION><SYNC_POINT_LOW>24000</SYNC_POINT_LOW><SYNC_POINT_HIGH>0</SYNC_POINT_HIGH></SYNC_POINT>'
	+ '<SYNC_POINT><SYNC_POINT_TYPE>ABSOLUTE</SYNC_POINT_TYPE><SYNC_POINT_FUNCTION>SLATE_GENERIC</SYNC_POINT_FUNCTION><SYNC_POINT_LOW>123</SYNC_POINT_LOW><SYNC_POINT_HIGH>1</SYNC_POINT_HIGH></SYNC_POINT>'
	+ '</SYNC_POINT_LIST></BWFXML>';

test('WAV import promotion retains standard recorder iXML sync-point type, sample words and function', async () => {
	const bytes = encodeWav([new Float32Array(48_000)], { sampleRate: 48_000, ixml: { rawXml: xml } });
	const descriptor = await inspectWavBlobPcm(new Blob([Uint8Array.from(bytes)]));
	const project = createCurrentAudioEditorProject({ sampleRate: 48_000 });
	const promoted = prepareImportedWavMetadata({ descriptor, project, projectSampleRate: project.sampleRate,
		importOptions: normalizeProjectImportOptions({ destination: 'timeline', timelineStartFrame: 4800 }, 'Invalid timeline position.'),
		copy: {}, freezeImportOptions: freezeProjectImportOptions });
	assert.deepEqual(promoted.projectIxml.syncPoints, [
		{ type: 'RELATIVE', sampleCount: '28800', function: 'SLATE_GENERIC' },
		{ type: 'ABSOLUTE', sampleCount: '4294967419', function: 'SLATE_GENERIC' },
	]);
	const generated = new TextDecoder().decode(encodeIxmlPayload({ ...promoted.projectIxml, rawXml: '' }));
	assert.ok(generated.includes('<SYNC_POINT_TYPE>ABSOLUTE</SYNC_POINT_TYPE>'));
	assert.ok(generated.includes('<SYNC_POINT_LOW>123</SYNC_POINT_LOW><SYNC_POINT_HIGH>1</SYNC_POINT_HIGH>'));
	assert.ok(generated.includes('<SYNC_POINT_FUNCTION>SLATE_GENERIC</SYNC_POINT_FUNCTION>'));
	assert.ok(generated.includes('<SYNC_POINT_COUNT>2</SYNC_POINT_COUNT>'));
});
