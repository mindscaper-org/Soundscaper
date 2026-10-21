/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { createAup3ProjectDocument, type Aup3XmlNode, type Aup3XmlNodeEntry } from '../src/common/editor/aup3-profile.ts';
import { createAup4ExportPlan } from '../src/common/editor/aup4-export.js';
import { decodeLegacyAupProject } from '../src/common/editor/aup-legacy.js';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

interface GainPoint { readonly frame: number; readonly value: number }
const RATE = 48_000;
const POINTS = [{ frame: 0, value: 1 }, { frame: RATE, value: 0.25 }];
const makeIds = () => { let index = 0; return (prefix: string) => `${prefix}-${String(++index)}`; };

function gainAt(points: readonly GainPoint[], frame: number, logarithmic = false): number {
	const rightIndex = points.findIndex((point) => point.frame >= frame);
	if (rightIndex < 0) return points.at(-1)?.value ?? 1;
	if (rightIndex === 0) return points[0]!.value;
	const left = points[rightIndex - 1]!, right = points[rightIndex]!;
	const fraction = (frame - left.frame) / (right.frame - left.frame);
	return logarithmic ? Math.exp(Math.log(left.value) * (1 - fraction) + Math.log(right.value) * fraction)
		: left.value + (right.value - left.value) * fraction;
}

for (const format of ['aup3', 'aup4', 'legacy'] as const) {
	test(`MP33: ${format} Audacity File Open preserves logarithmic envelope gain between controls`, async () => {
		let points: readonly GainPoint[];
		if (format !== 'legacy') {
			const root = createAudacityXmlNode('project', [{ kind: 'attribute', name: 'rate', type: 'double', value: RATE }], [
				createAudacityXmlNode('wavetrack', [], [createAudacityXmlNode('waveclip', [], [
					createAudacityXmlNode('sequence', [{ kind: 'attribute', name: 'numsamples', type: 'long-long', value: RATE }], [
						createAudacityXmlNode('waveblock', [{ kind: 'attribute', name: 'start', type: 'long-long', value: 0 },
							{ kind: 'attribute', name: 'blockid', type: 'long-long', value: -RATE }]),
					]),
					createAudacityXmlNode('envelope', [], POINTS.map((point) => createAudacityXmlNode('controlpoint', [
						{ kind: 'attribute', name: 't', type: 'double', value: point.frame / RATE },
						{ kind: 'attribute', name: 'val', type: 'double', value: point.value },
					]))),
				])]),
			]);
			const imported = await decodeAudacityProjectTree(root, async () => null, { idFactory: makeIds(), planAudio: true, sourceGeneration: format });
			points = imported.project.clips[0]!.envelope as GainPoint[];
		} else {
			const decoded = await decodeLegacyAupProject(new File([`<project rate="48000"><wavetrack><waveclip>
				<sequence numsamples="48000"><waveblock start="0"><silentblockfile len="48000"/></waveblock></sequence>
				<envelope><controlpoint t="0" val="1"/><controlpoint t="1" val="0.25"/></envelope>
				</waveclip></wavetrack></project>`], 'envelope.aup'), []);
			points = convertLegacyAupToProject(decoded, { idFactory: makeIds() }).project.clips[0]!.envelope as GainPoint[];
		}
		for (const frame of [RATE / 4, RATE / 2, RATE * 3 / 4]) {
			assert.ok(Math.abs(gainAt(points, frame) - 0.25 ** (frame / RATE)) < 0.0002,
				`native exponential amplitude at ${String(frame)} must survive import`);
		}
	});
}

test('MP33: AUP3 Audacity export preserves a linear editor envelope under the native logarithmic interpolator', () => {
	const source = createAudioSource({ id: 'source', frameCount: RATE, sampleRate: RATE, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: RATE,
		sourceDurationFrames: RATE, envelope: POINTS });
	const project = createCurrentAudioEditorProject({ id: 'envelope-project', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const document = createAup3ProjectDocument(createAup4ExportPlan(project).project).document;
	const tree = document.roots.find((entry) => entry.kind === 'node' && entry.node.name === 'project');
	assert.ok(tree?.kind === 'node');
	const nativeClip = children(children(tree.node, 'wavetrack')[0], 'waveclip')[0];
	const points = children(children(nativeClip, 'envelope')[0], 'controlpoint').map((point) => ({
		frame: attributeNumber(point, 't') * RATE, value: attributeNumber(point, 'val'),
	}));
	for (const frame of [RATE / 4, RATE / 2, RATE * 3 / 4]) {
		assert.ok(Math.abs(gainAt(points, frame, true) - gainAt(POINTS, frame)) < 0.0002,
			`linear authored amplitude at ${String(frame)} must survive export`);
	}
});

function children(node: Aup3XmlNode | undefined, name: string): Aup3XmlNode[] {
	return node?.content.filter((entry): entry is Aup3XmlNodeEntry => entry.kind === 'node' && entry.node.name === name)
		.map((entry) => entry.node) ?? [];
}

function attributeNumber(node: Aup3XmlNode, name: string): number {
	const attribute = node.content.find((entry) => entry.kind === 'attribute' && entry.name === name);
	return Number(attribute?.kind === 'attribute' ? attribute.value : NaN);
}
