/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProjectTranscripts, type TranscriptGenerationSession } from
	'../src/common/editor/controller/assistance/transcript-generation-session.ts';

function fixture() {
	const project = { id: 'project', revision: 0 };
	const calls: string[] = [];
	const targets = ['a', 'b'].map(clipId => ({ clipId, trackId: `track-${clipId}`, startFrame: 0, endFrame: 100 }));
	let phase = 'ready';
	const session: TranscriptGenerationSession = {
		getSnapshot: () => ({ phase, error: null, canReview: phase === 'completed',
			review: phase === 'review-ready' ? { choices: [{ id: 'captions', enabled: true }] } : null }),
		run: async () => { calls.push('run'); phase = 'completed'; },
		review: async () => { calls.push('review'); phase = 'review-ready'; },
		setReviewChoiceSelected: id => { calls.push(id); },
		accept: async () => { calls.push('accept'); project.revision += 1; phase = 'accepted'; },
		dispose: async () => { calls.push('dispose'); },
	};
	return { project, calls, targets, session, options: { getProject: () => project, targets,
		selectTarget: (target: { clipId: string }) => { calls.push(target.clipId); },
		createSession: () => { phase = 'ready'; return session; },
		signal: new AbortController().signal, onProgress: () => undefined } };
}

test('generates and accepts every audio occurrence sequentially through authenticated review', async () => {
	const f = fixture();
	await generateProjectTranscripts(f.options);
	assert.deepEqual(f.calls, ['a', 'run', 'review', 'captions', 'accept', 'dispose',
		'b', 'run', 'review', 'captions', 'accept', 'dispose']);
	assert.equal(f.project.revision, 2);
});

test('selection revisions belong to generation while changes during inference are refused', async () => {
	const f = fixture();
	await generateProjectTranscripts({ ...f.options, selectTarget: target => {
		f.options.selectTarget(target); f.project.revision += 2;
	} });
	assert.equal(f.project.revision, 6);
});

test('cancellation stops later audio and always disposes native custody', async () => {
	const f = fixture(), cancellation = new AbortController();
	f.session.run = async () => { cancellation.abort(); };
	await assert.rejects(generateProjectTranscripts({ ...f.options, signal: cancellation.signal }), { name: 'AbortError' });
	assert.ok(f.calls.includes('dispose'));
	assert.ok(!f.calls.includes('b'));
	assert.equal(f.project.revision, 0);
});

test('a changed document or unavailable inference stops the queue without accepting', async () => {
	const f = fixture();
	f.session.run = async () => { f.project.revision += 1; };
	await assert.rejects(generateProjectTranscripts(f.options), /changed/iu);
	assert.ok(!f.calls.includes('accept'));
	const unavailable = fixture();
	unavailable.session.getSnapshot = () => ({ phase: 'unavailable', error: null, unavailableReason: 'model-missing', canReview: false, review: null });
	await assert.rejects(generateProjectTranscripts(unavailable.options), /model-missing/iu);
	assert.ok(!unavailable.calls.includes('accept'));
});
