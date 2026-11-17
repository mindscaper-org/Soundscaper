/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseReaperDocument } from '../src/common/editor/reaper-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

// Download reference structures only for this audit; no third-party project or media is redistributed.
const references = [
	{ file: 'empty.RPP', sha256: 'f63dd561c43ed249225b5b6b4b2e61e69c79495eaf4e3041d65673f5eaef6538', tracks: 2, sampleRate: 48000 },
	{ file: 'vst.RPP', sha256: '8ec35252f397fd8ed7050d6c08748c16af40b5e8e1052d85fba1cb94ef19861b', tracks: 10, sampleRate: 44100 },
] as const;

for (const reference of references) {
	const response = await fetch(`https://raw.githubusercontent.com/Perlence/rpp/6ea00bb6db76724d3521748b3effa7260f1ebf8e/tests/data/${reference.file}`, { signal: AbortSignal.timeout(20000) });
	if (!response.ok) throw new Error(`REAPER reference download failed: ${response.status}.`);
	const reader = response.body!.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > 64 * 1024) throw new RangeError('REAPER reference exceeds its byte limit.');
			chunks.push(value);
		}
	} finally { await reader.cancel(); reader.releaseLock(); }
	const bytes = Buffer.concat(chunks);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256);
	const document = parseReaperDocument(bytes.toString('utf8'));
	assert.equal(document.sampleRate, reference.sampleRate);
	assert.equal(document.tracks.length, reference.tracks);
	let next = 0;
	const plan = buildTimelineInterchangeProject(document, { fileName: reference.file, createStableId: prefix => `${prefix}-${++next}` });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.tracks.length, reference.tracks);
	assert.equal(project.clips.length, 0);
	if (reference.file === 'vst.RPP') {
		assert.ok(document.issues.some(issue => issue.code === 'reaper.source-omitted'));
		assert.ok(document.issues.some(issue => issue.code === 'reaper.processing-omitted'));
		assert.ok(document.issues.some(issue => issue.code === 'reaper.routing-omitted'));
	}
}
console.log('REAPER import audit passed: pinned empty and mixed-source/FX project structures. Audio rendering equivalence is unverified.');
