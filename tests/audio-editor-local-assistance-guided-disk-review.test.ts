/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { mkdtemp, open, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveLocalAssistanceWorkflowBridge } from '../src/common/editor/assistance/local-assistance-workflow-bridge.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';
import { bindLocalAssistancePreparedAudioWaveRelease, releaseLocalAssistancePreparedAudioWave } from
	'../src/common/editor/controller/assistance/local-assistance-audio-spool-release.ts';
import { createLocalAssistanceGuidedSessionStore } from '../src/common/editor/ui/local-assistance-guided-session-store.ts';
import { createWavHeader } from '../src/common/editor/wav.js';
import { JOB_ID, model, preparationFixture, project } from
	'./helpers/audio-editor-local-assistance-guided-preparation-fixture.ts';

test('long Guided audio reaches workflow execution and retains its exact disk body until the dialog closes', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'guided-model-audio.'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const path = join(directory, 'prepared.wav');
	const frameCount = 4_200_000;
	const header = createWavHeader({ sampleRate: 48_000, channelCount: 2, totalFrames: frameCount,
		bitDepth: 32, float: true });
	const byteLength = header.byteLength + frameCount * 8;
	const file = await open(path, 'wx');
	try {
		await file.writeFile(header);
		await file.truncate(byteLength);
	} finally { await file.close(); }
	const body = await openAsBlob(path, { type: 'audio/wav' });
	bindLocalAssistancePreparedAudioWaveRelease(body, () => unlink(path));
	context.after(async () => { await releaseLocalAssistancePreparedAudioWave(body).catch(() => undefined); });
	const fixture = preparationFixture(project(), false, undefined, 'voice-clip', body);
	const raw = resolveLocalAssistanceWorkflowBridge({
		createJob: async () => ({ contractVersion: 1, jobId: JOB_ID }),
		run: async (request: AssistanceWorkflowV1) => ({
			contractVersion: 1, jobId: JOB_ID, workflowId: 'enhance-dialogue', outcome: 'completed',
			result: { contractVersion: 1, jobId: JOB_ID, workflowId: 'enhance-dialogue',
				stageIds: request.stageIds, outputs: request.outputs },
		}),
		cancel: async () => ({ contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled' }),
		onProgress: () => () => undefined,
		readOutput: async () => body,
		custody: { ...fixture.custody, stageInput: async (
			request: Omit<Parameters<typeof fixture.custody.stageInput>[0], 'signal'>,
		) => fixture.custody.stageInput({ ...request, signal: new AbortController().signal }) },
	});
	assert.ok(raw);
	const store = createLocalAssistanceGuidedSessionStore({
		bridge: { workflow: raw, models: async () => [model('deepfilternet3', '3.0.0', 'speech-enhancement', 1)] },
		preparation: { ...fixture.preparation,
			listSelectedMedia: async () => ({ sources: [] }),
			prepareSelectedMedia: async () => { throw new Error('Guided only'); } },
	});
	store.selectWorkflow('enhance-dialogue');
	try {
		await store.run();
		assert.equal(store.getSnapshot().phase, 'completed', store.getSnapshot().error ?? 'Guided execution did not complete.');
		await store.review();
		const snapshot = store.getSnapshot();
		assert.equal(snapshot.phase, 'review-ready', snapshot.error ?? 'Guided review did not open.');
		assert.equal(snapshot.auditionAudio, body);
		assert.equal((await stat(path)).size, byteLength);
		assert.deepEqual(new Uint8Array(await body.slice(0, header.byteLength).arrayBuffer()), header);
	} finally { await store.dispose(); }
	await assert.rejects(stat(path), { code: 'ENOENT' });
});
