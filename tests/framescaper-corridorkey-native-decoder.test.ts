/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeyingVideoDecoderWithNativeFallback } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-native-decoder.ts';
import { KeyingBrowserVideoDecodeError } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-decoder.ts';
import { createLocalAssistanceVideoKeyingFramePreparation } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-frames.ts';
import { reviewAssistanceVisualFramePackV2 } from '../src/common/editor/assistance/visual-frame-pack-v2.ts';
import type { LocalAssistanceVideoKeyingRun } from '../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-publication.ts';
import type { LocalAssistanceBridge } from '../src/common/editor/assistance/local-assistance-bridge.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';

const body = new Blob(['immutable-ProRes-original'], { type: 'video/quicktime' });
async function fixture() {
	const events: string[] = []; const sha256 = await digestMediaContent(body); const jobId = '1'.repeat(40);
	const run: LocalAssistanceVideoKeyingRun = { projectId: 'p', clipId: 'c', width: 2, height: 2, sourceFrameCount: 3,
		source: { contentSha256: sha256 }, frameRate: { num: 25, den: 1 }, timescale: 25,
		sourceEndTick: 3n, presentationTick: BigInt, selectionFence: {} as never };
	const bridge = { createJob: async () => { events.push('create'); return { contractVersion: 1, jobId }; },
		stageInput: async () => { events.push('stage'); return { claimVersion: 1, claimId: '2'.repeat(40), jobId,
			role: 'video', mediaType: body.type, byteLength: body.size, sha256 }; },
		videoKeying: { decodeSource: async () => { events.push('decode'); return { contractVersion: 1, jobId, sourceSha256: sha256,
			width: 2, height: 2, frameCount: 3, byteLength: 48 }; }, readDecodedSource: async ({ offset, maximumBytes }: { offset: number; maximumBytes: number }) => {
			events.push(`read:${offset}`); return Uint8Array.from({ length: maximumBytes }, (_value, index) => index % 4 === 3 ? 255 : Math.floor(offset / 16));
		} }, cancel: async () => { events.push('cancel'); }, release: async () => { events.push('release'); },
	} as unknown as LocalAssistanceBridge;
	return { run, bridge, events };
}
const unsupported = async () => { throw new KeyingBrowserVideoDecodeError(); };

test('unsupported browser codecs use native full-source ordinals without changing frame-pack authority', async () => {
	const held = await fixture();
	const prepare = createLocalAssistanceVideoKeyingFramePreparation({ loadOriginal: async () => body,
		createDecoder: createKeyingVideoDecoderWithNativeFallback(held.bridge, unsupported) });
	const packs = [];
	for await (const pack of prepare(held.run, { signal: new AbortController().signal, assertCurrent() {} })) packs.push(pack);
	const reviewed = reviewAssistanceVisualFramePackV2(new Uint8Array(await packs[0]!.arrayBuffer()));
	assert.equal(reviewed.frameCount, 3);
	for (let ordinal = 0; ordinal < 3; ordinal += 1) {
		assert.deepEqual(reviewed.frameTiming(ordinal), { sourceFrame: ordinal, presentationTick: String(ordinal) });
		assert.equal(reviewed.frame(ordinal).rgba[0], ordinal);
	}
	assert.deepEqual(held.events, ['create', 'stage', 'decode', 'read:0', 'read:16', 'read:32', 'release']);
});
test('supported browser codecs and display geometry errors do not launch native extraction', async () => {
	const held = await fixture(); const decoder = { capture: async () => new Uint8Array(16), dispose() {} };
	assert.equal(await createKeyingVideoDecoderWithNativeFallback(held.bridge, async () => decoder)(body, held.run, new AbortController().signal), decoder);
	await assert.rejects(createKeyingVideoDecoderWithNativeFallback(held.bridge, async () => { throw new Error('unsupported display rotation'); })(body, held.run, new AbortController().signal), /rotation/u);
	assert.deepEqual(held.events, []);
});
test('aborted or malformed native source decodes release their separate job exactly once', async () => {
	for (const abort of [false, true]) {
		const held = await fixture(); const control = new AbortController();
		held.bridge.videoKeying!.decodeSource = async () => {
			if (abort) control.abort(new Error('cancel native extraction'));
			return { contractVersion: 1, jobId: '1'.repeat(40), sourceSha256: '', width: 2, height: 2, frameCount: 3, byteLength: 48 };
		};
		await assert.rejects(createKeyingVideoDecoderWithNativeFallback(held.bridge, unsupported)(body, held.run, control.signal), /cancel native|geometry/u);
		assert.equal(held.events.filter(value => value === 'release').length, 1);
		assert.equal(held.events.includes('cancel'), abort);
	}
});

test('native fallback retains the captured MIME for generic linked-original blobs', async () => {
	const held = await fixture(); let stagedType = '';
	const stage = held.bridge.stageInput;
	held.bridge.stageInput = async request => { stagedType = request.mediaType; return stage(request); };
	const decoder = await createKeyingVideoDecoderWithNativeFallback(held.bridge, unsupported)(new Blob([body]),
		{ ...held.run, source: { ...held.run.source, mimeType: 'application/mxf' } }, new AbortController().signal);
	assert.equal(stagedType, 'application/mxf'); await Promise.all([decoder.dispose(), decoder.dispose()]);
	assert.equal(held.events.filter(value => value === 'release').length, 1);
});
