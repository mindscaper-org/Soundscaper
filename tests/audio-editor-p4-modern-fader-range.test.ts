/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audacityXmlChildren, decodeAudacityBinaryXml } from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { createAup4EffectsNode } from '../src/common/editor/aup4-effects.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createAup4SampleBlock } from '../src/common/editor/aup4-profile.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAup3ProjectData } from './aup3-fixture.js';

for (const sourceGeneration of ['aup3', 'aup4'] as const) for (const gain of [8, 10 ** (36 / 20), 64, 4, 1, 0]) {
	test(`${sourceGeneration} fader ${gain} keeps its scalar, envelope and original PCM`, async () => {
		const fixture = createAup3ProjectData({ tracks: [{ name: 'Voice', gain,
			clips: [{ samples: [.002, -.002, .001], envelope: true }] }] });
		const root = decodeAudacityBinaryXml(fixture.dictionary, fixture.document).root;
		let ordinal = 0;
		const decoded = await decodeAudacityProjectTree(root, async () => createAup4SampleBlock(Float32Array.of(.002, -.002, .001)),
			{ sourceGeneration, idFactory: (prefix: string) => `${prefix}-${++ordinal}` });
		const project: unknown = decoded.project; assert.ok(validateAudioEditorProjectV17(project));
		const track = project.tracks.find(entry => entry.type === 'audio');
		assert.ok(track?.type === 'audio'); const clip = project.clips[0]; assert.ok(clip?.kind === 'audio');
		assert.equal(track.gain * clip.gain, gain);
		assert.equal(clip.envelope[0]?.value, .5);
		const source = decoded.sources[0]; assert.ok(source?.channels);
		assert.deepEqual(source.channels[0], Float32Array.of(.002, -.002, .001));
		if (gain > 4) {
			assert.match(decoded.warnings.join('\n'), /fader.*clip gain/u);
			assert.ok(decoded.compatibilityReport.items.some((item: { code: string }) => item.code === 'TRACK_FADER_GAIN_CONVERTED'));
		}
	});
}

for (const rack of ['active', 'bypassed', 'disabled-effect'] as const) for (const gain of [8, 4]) test(`a retained ${rack} nonlinear rack with fader ${gain} preserves its post-effect gain authority`, async () => {
	const fixture = createAup3ProjectData({ tracks: [{ name: 'Distorted voice', gain, clips: [{ samples: [.002] }] }] });
	const root = decodeAudacityBinaryXml(fixture.dictionary, fixture.document).root;
	const children = audacityXmlChildren as unknown as (node: unknown, name: string) => { content: unknown[] }[];
	const track = children(root, 'wavetrack')[0]; assert.ok(track);
	track.content.push({ kind: 'node', node: createAup4EffectsNode([createEffect('audacity-distortion', { enabled: rack !== 'disabled-effect' })], null, { effectsActive: rack !== 'bypassed' }) });
	let reads = 0;
	const operation = decodeAudacityProjectTree(root, () => { reads += 1; return createAup4SampleBlock(Float32Array.of(.002)); }, { planAudio: gain <= 4 });
	if (gain > 4) {
		await assert.rejects(operation, /fader.*realtime rack/u);
		assert.equal(reads, 0, 'the known incompatible control is refused before reading source PCM');
	}
	else {
		const decoded = await operation;
		const project: unknown = decoded.project; assert.ok(validateAudioEditorProjectV17(project));
		const owner = project.tracks[0]; assert.ok(owner?.type === 'audio');
		assert.equal(owner.gain, gain); assert.equal(owner.effects[0]?.type, 'audacity-distortion');
		const clip = project.clips[0]; assert.ok(clip?.kind === 'audio'); assert.equal(clip.gain, 1);
	}
});

test('an unrepresentable Audacity fader refuses instead of silently replacing the authored value', async () => {
	const fixture = createAup3ProjectData({ tracks: [{ gain: 65, clips: [{ samples: [.002] }] }] });
	const root = decodeAudacityBinaryXml(fixture.dictionary, fixture.document).root;
	await assert.rejects(decodeAudacityProjectTree(root, () => null, { planAudio: true }), /combined track and clip gain range/u);
});

for (const gain of [8, 4]) test(`an empty track with fader ${gain} cannot claim gain held by nonexistent clips`, async () => {
	const fixture = createAup3ProjectData({ tracks: [{ name: 'Empty', gain, clips: [] }] });
	const root = decodeAudacityBinaryXml(fixture.dictionary, fixture.document).root;
	const operation = decodeAudacityProjectTree(root, () => null, { planAudio: true });
	if (gain > 4) await assert.rejects(operation, /requires playable clips/u);
	else assert.equal((await operation).project.tracks[0]?.gain, gain);
});
