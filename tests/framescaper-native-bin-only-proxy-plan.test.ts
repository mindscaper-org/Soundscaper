/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { createFramescaperNativeProResProxyGenerator } from '../src/framescaper/editor-native-prores-proxy-generator.ts';
import { createFramescaperNativeProxySourcePlan } from '../src/framescaper/editor-native-proxy-source-plan.ts';
import type { FramescaperNativeServicesBridge } from '../src/common/editor/ui/framescaper-native-services-bridge.ts';

function project(empty: boolean) {
	const options = framescaperV20Options();
	if (empty) { options.clips = []; options.tracks = (options.tracks as Record<string, unknown>[]).map(track => ({ ...track, clipIds: [] })); }
	return createFramescaperProjectNativeMedia(PROFILE, options);
}

test('the bin-only native proxy action reaches desktop admission without any timeline placements', async () => {
	const value = project(true); assert.equal((value.clips as readonly unknown[]).length, 0);
	assert.equal((value.projectBin as { clips: readonly unknown[] }).clips.length, 1);
	let snapshots = 0;
	const bridge = { snapshot: async () => { snapshots += 1; throw new Error('source plan reached desktop admission'); },
		control: async () => undefined, reorder: async () => [], remove: async () => false, capabilities: async () => null,
		enqueue: async () => undefined, selectRoot: async () => null, revalidateRoot: async () => true,
		claimProxyOutput: async () => undefined, readProxyOutput: async () => new Uint8Array(), releaseProxyOutput: async () => true,
	} as unknown as FramescaperNativeServicesBridge;
	const source = (value.sources as readonly Record<string, unknown>[]).find(candidate => candidate.kind === 'video')!;
	const generator = createFramescaperNativeProResProxyGenerator({ profile: PROFILE, getProject: () => value, bridge });
	await assert.rejects(async () => { await generator.generate(new Blob([new Uint8Array(1)], { type: 'video/mp4' }),
		{ authority: 'owned', projectId: String(value.id), sourceId: String(source.id), storageKey: String(source.id), mimeType: 'video/mp4',
			byteLength: 1, sha256: String(source.contentSha256), generationToken: 'generation' },
		{ id: 'framescaper-native-prores-proxy-mov-v1', version: 1 }, { assertCurrent() {}, signal: new AbortController().signal }); },
	/source plan reached desktop admission/u);
	assert.equal(snapshots, 1);
});

test('a proxy plan binds the whole source and is independent of unrelated timeline duration', () => {
	const empty = createFramescaperNativeProxySourcePlan(project(true), 'video-source');
	const placed = createFramescaperNativeProxySourcePlan(project(false), 'video-source');
	assert.equal(empty.timebase.sampleDuration, placed.timebase.sampleDuration);
	assert.deepEqual(empty.sources.map(source => source.sourceId), ['video-source']);
	assert.equal(empty.output.includeAudio, false);
	assert.equal(empty.nodes.some(node => node.kind === 'clip'), false);
	assert.equal(empty.nodes.filter(node => node.kind === 'professional-media').length, 1);
	assert.equal(empty.sources[0]?.timing.kind, 'cfr');
});


test('a bin-only proxy retains its whole verified VFR source clock', context => {
	const options = framescaperV20Options();
	options.clips = []; options.tracks = (options.tracks as Record<string, unknown>[]).map(track => ({ ...track, clipIds: [] }));
	const raw = (options.sources as Record<string, unknown>[]).find(source => source.kind === 'video')!;
	const publication = createVideoTimingAssetPublication(String(raw.contentSha256), {
		timescale: 1000, presentationTicks: [0n, 50n, 150n, 250n, 350n, 450n, 550n, 650n, 750n, 900n], finalFrameDurationTicks: 100n });
	Object.assign(raw, { timingAsset: publication.reference, timingDecision: { mode: 'exact', rate: { num: 10, den: 1 }, backend: 'demuxer' } });
	const value = createFramescaperProjectNativeMedia(PROFILE, options);
	const source = (value.sources as readonly Record<string, unknown>[]).find(candidate => candidate.kind === 'video')!;
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(publication.reference, publication.bytes));
	context.after(() => { unregisterVideoTimingIndex(source); });
	const plan = createFramescaperNativeProxySourcePlan(value, String(source.id));
	assert.equal(plan.timebase.sampleDuration, value.sampleRate);
	assert.deepEqual(plan.sources[0]!.timing, { kind: 'vfr', reference: publication.reference });
	assert.equal(plan.nodes.some(node => node.kind === 'clip'), false);
});
