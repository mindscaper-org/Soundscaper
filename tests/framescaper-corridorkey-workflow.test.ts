/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalAssistanceVideoKeyingWorkflow } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-workflow.ts';
import { createAssistanceVisualFramePackV2 } from '../src/common/editor/assistance/visual-frame-pack-v2.ts';
import type { LocalAssistanceBridge, LocalAssistanceOutputClaim, LocalAssistanceRunRequest } from '../src/common/editor/assistance/local-assistance-bridge.ts';
import type { LocalAssistanceVideoKeyingRun } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-publication.ts';
import { digestMediaContent } from '../src/common/media/content-digest.ts';

import { CORRIDORKEY_CHROMA_HINT_DEFAULTS } from '../src/common/editor/assistance/corridorkey-hint-settings.ts';

const TYPE = 'application/vnd.soundscaper.frame-pack';
const JOB = '01'.repeat(20);
const MODEL = { modelId: 'corridorkey-2.0', version: '2.0.0', task: 'video-keying', artifactSha256s: ['ab', 'bc', 'cd', 'de', 'ef'].map((value) => value.repeat(32)) };
const run: LocalAssistanceVideoKeyingRun = {
	projectId: 'p', clipId: 'clip', source: { id: 'source' }, width: 2, height: 2,
	sourceFrameCount: 2, frameRate: { num: 10, den: 1 }, timescale: 10, sourceEndTick: 2n,
	presentationTick: (frame) => BigInt(frame),
	selectionFence: { projectId: 'p', schemaFamily: 'framescaper', schemaVersion: 1, revision: 0,
		sequenceId: 'main', occurrenceIds: ['clip'], sourceId: 'source', sourceSha256: '12'.repeat(32),
		sourceStartFrame: 0, sourceEndFrame: 2, linkMembershipSha256: '34'.repeat(32), timingAuthoritySha256: '56'.repeat(32) },
};
function pack(first: number, tick = first) {
	return new Blob(createAssistanceVisualFramePackV2({ sourceWidth: 2, sourceHeight: 2,
		rasterWidth: 2, rasterHeight: 2, timescale: 10,
		frames: [{ sourceFrame: first, presentationTick: String(tick), rgba: new Uint8Array(16).fill(128) }],
	}).map((chunk) => Uint8Array.from(chunk)), { type: TYPE });
}
function harness(capturedRun: LocalAssistanceVideoKeyingRun = run) {
	const events: string[] = [];
	const requests: LocalAssistanceRunRequest[] = [];
	let stale = false;
	let failModel = false;
	let wrongOutput = false;
	let abortedRun: (() => void) | null = null;
	let declined = false;
	const inputs: Blob[] = [];
	const claims: LocalAssistanceOutputClaim[] = [];
	const bridge = {
		models: async () => [MODEL], createJob: async () => ({ contractVersion: 1 as const, jobId: JOB }),
		async stageInput(value) { events.push('stage'); inputs.push(value.bytes); return { claimVersion: 1,
			claimId: String(inputs.length).padStart(40, '0'), jobId: JOB, role: 'frame-pack', mediaType: TYPE,
			byteLength: value.bytes.size, sha256: await digestMediaContent(value.bytes) }; },
		async reserveOutput(value) { return { claimVersion: 1, claimId: String(10 + inputs.length).padStart(40, '0'),
			jobId: JOB, role: 'keyed-frames', mediaType: TYPE, maximumByteLength: value.maximumByteLength }; },
		async run(request) { requests.push(request); events.push('run'); abortedRun?.();
			if (declined) return { contractVersion: 1, jobId: JOB, operation: 'video-keying', outcome: 'consent-declined' };
			for (let index = 0; index < request.outputs.length; index += 1) {
				const output = request.outputs[index]!; const body = wrongOutput && index === 1 ? pack(1, 2) : inputs[index]!;
				claims.push({ ...output, byteLength: body.size, sha256: await digestMediaContent(body) });
			}
			return { contractVersion: 1, jobId: JOB, operation: 'video-keying', outcome: 'completed',
				result: { contractVersion: 1, jobId: JOB, operation: 'video-keying', outputs: claims } }; },
		async readOutput({ claim }) { events.push('read'); return wrongOutput && claims.indexOf(claim) === 1 ? pack(1, 2) : inputs[claims.indexOf(claim)]!; },
		cancel: async () => { events.push('cancel'); return { contractVersion: 1, jobId: JOB, outcome: 'cancelled' }; },
		release: async () => { events.push('release'); return true; }, onProgress: () => () => { events.push('unsubscribe'); },
	} satisfies LocalAssistanceBridge;
	const workflow = createLocalAssistanceVideoKeyingWorkflow({ bridge,
		publication: { capture: async () => capturedRun, assertCurrent() { if (stale) throw new Error('stale'); },
			accept: async () => { events.push('accept'); return { sourceId: 'keyed-source' }; } },
		preflightModel: async () => { if (failModel) throw new Error('model unavailable'); return MODEL; },
		prepareFrames: async function* () { yield pack(0); yield pack(1); },
		encodeAlphaWebm: async () => { events.push('encode'); return { body: new Blob(['webm'], { type: 'video/webm' }),
			sha256: 'ab'.repeat(32), modelId: MODEL.modelId, modelVersion: MODEL.version }; },
	});
	return { workflow, events, requests, setStale() { stale = true; }, setNoModel() { failModel = true; },
		setWrongOutput() { wrongOutput = true; }, setDeclined() { declined = true; }, onRun(callback: () => void) { abortedRun = callback; } };
}

test('CorridorKey checks every returned pack before encoding and publishes once then releases custody', async () => {
	const fixture = harness();
	assert.deepEqual(await fixture.workflow.run(), { sourceId: 'keyed-source' });
	assert.deepEqual(fixture.events, ['stage', 'stage', 'run', 'read', 'read', 'encode', 'accept', 'unsubscribe', 'release']);
});
test('unoffered models and stale captures do not begin any desktop job', async () => {
	for (const mode of ['model', 'stale']) { const fixture = harness();
		if (mode === 'model') fixture.setNoModel(); else fixture.setStale();
		await assert.rejects(fixture.workflow.run()); assert.deepEqual(fixture.events, []);
	}
});
test('a mismatched source timestamp prevents encoding and publication while releasing claims', async () => {
	const fixture = harness(); fixture.setWrongOutput(); await assert.rejects(fixture.workflow.run(), /timing/u);
	assert.ok(!fixture.events.includes('encode')); assert.ok(!fixture.events.includes('accept'));
	assert.equal(fixture.events.at(-1), 'release');
});
test('cancellation during inference cancels the job and prevents output reads and canonical edits', async () => {
	const fixture = harness(); const cancellation = new AbortController();
	fixture.onRun(() => cancellation.abort(new Error('cancel keying')));
	await assert.rejects(fixture.workflow.run({ signal: cancellation.signal }), /cancel keying/u);
	assert.ok(fixture.events.includes('cancel')); assert.ok(!fixture.events.includes('read'));
	assert.ok(!fixture.events.includes('accept')); assert.equal(fixture.events.at(-1), 'release');
});


test('CorridorKey refuses existing alpha, HDR and scene-linear sources before creating a job', async () => {
	for (const characteristics of [{ hasAlpha: true }, ...['smpte2084', 'arib-std-b67', 'linear', 'PQ', 'HLG', 'smpte_st_2084']
		.map((transfer) => ({ colour: { transfer } }))]) {
		const fixture = harness({ ...run, source: { ...run.source, characteristics } });
		await assert.rejects(fixture.workflow.run(), /opaque source|display-referred SDR/u);
		assert.deepEqual(fixture.events, []);
	}
});
test('declined processing releases prepared claims without reading or publishing outputs', async () => {
	const fixture = harness(); fixture.setDeclined();
	await assert.rejects(fixture.workflow.run(), /consent was declined/u);
	assert.deepEqual(fixture.events, ['stage', 'stage', 'run', 'unsubscribe', 'release']);
});
test('a selection changed while inference runs prevents output reads and publication', async () => {
	const fixture = harness(); fixture.onRun(() => fixture.setStale());
	await assert.rejects(fixture.workflow.run(), /stale/u);
	assert.deepEqual(fixture.events, ['stage', 'stage', 'run', 'unsubscribe', 'release']);
});

test('keying snapshots hint controls before preparing frames and preserves default no-hint requests', async () => {
	const fixture = harness(); const hint = { ...CORRIDORKEY_CHROMA_HINT_DEFAULTS };
	const pending = fixture.workflow.run({ hint }); hint.keyColor = 0x0000ff;
	await pending;
	assert.deepEqual(fixture.requests[0]!.settings, CORRIDORKEY_CHROMA_HINT_DEFAULTS);
	const normal = harness(); await normal.workflow.run();
	assert.equal(Object.hasOwn(normal.requests[0]!, 'settings'), false);
	const invalid = harness();
	await assert.rejects(invalid.workflow.run({ hint: { ...hint, softness: -1 } }), /hint|softness/iu);
	assert.deepEqual(invalid.events, []);
	await invalid.workflow.run();
});
