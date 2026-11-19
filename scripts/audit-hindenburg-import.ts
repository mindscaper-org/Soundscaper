/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseHindenburgDocument } from '../src/common/editor/hindenburg-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

// Independently published session bytes are downloaded for this optional audit, never redistributed.
const references = [
	{
		url: 'https://raw.githubusercontent.com/ollisulopuisto/podcast/23a634f814131543b0f587e999b9de1eff0bb48e/packages/nhsx/tests/data/h-test%20A.nhsx',
		sha256: 'fdb8cb41dc6f9a94e45bd17c76cd10691daa7278c4c929bffea34fa3c0f400f5',
		sampleRate: 48000, tracks: 6, clips: 11, sources: 11,
	},
	{
		url: 'https://raw.githubusercontent.com/erikras/audio-editor/98160494701daef9d7875e752d88debf61addb0f/Tests/EditorCoreTests/Fixtures/sample.nhsx',
		sha256: '8dc26a1d74294efb9d7313855334c1be0e27a1f64206f4235cfcfd7541ad71e0',
		sampleRate: 44100, tracks: 2, clips: 3, sources: 3,
	},
	{
		url: 'https://raw.githubusercontent.com/KBNLresearch/Multimodal-Presentations/293ca259ccfd9a65d77aa5291e8420c3b79d858c/2.%20epubs%20met%20audio/marres%20stem/hindenburg%20sessies/EN%20voorgelezen%20Marre/Mending_Wall%20met%20timestamps%20en%20de%20rest.nhsx',
		sha256: '278bd4ce3b4b0e68d869266f7fee73a84256064d820196160df4e4abd07d480d',
		sampleRate: 44100, tracks: 2, clips: 48, sources: 48,
	},
] as const;

for (const reference of references) {
	const response = await fetch(reference.url, { signal: AbortSignal.timeout(20000) });
	if (!response.ok) throw new Error(`Hindenburg reference download failed: ${response.status}.`);
	const reader = response.body!.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > 64 * 1024) throw new RangeError('Hindenburg reference exceeds its byte limit.');
			chunks.push(value);
		}
	} finally { await reader.cancel(); reader.releaseLock(); }
	const bytes = Buffer.concat(chunks);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256);
	const document = parseHindenburgDocument(bytes.toString('utf8'));
	assert.equal(document.sampleRate, reference.sampleRate);
	assert.equal(document.tracks.length, reference.tracks);
	assert.equal(document.tracks.reduce((sum, track) => sum + track.clips.length, 0), reference.clips);
	assert.equal(document.media.length, reference.sources);
	let next = 0;
	const plan = buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++next}` });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.equal(project.clips.length, reference.clips);
	if (reference.sampleRate === 48000) {
		const clip = project.clips.find(clip => clip.title === 'A10_both_gain_clipgain')!;
		assert.equal(clip.timelineStartFrame, 4924848);
		assert.equal(clip.durationFrames, 240000);
		assert.equal(clip.gain, 10 ** (6 / 20));
		assert.ok(document.issues.some(issue => issue.code === 'hindenburg.ducking-omitted'));
	} else if (reference.clips === 3) {
		const clip = project.clips.find(clip => clip.title === 'EP1')!;
		assert.equal(clip.timelineStartFrame, 229541);
		assert.equal(clip.sourceStartFrame, 306495);
		assert.ok(document.issues.some(issue => issue.code === 'hindenburg.processing-omitted'));
	} else {
		assert.ok(document.issues.some(issue => issue.code === 'hindenburg.document-omitted'));
	}
}
console.log('Hindenburg import audit passed: pinned PRO, Lite and Narrator structures (62 audio cuts). Audio rendering equivalence is unverified.');
