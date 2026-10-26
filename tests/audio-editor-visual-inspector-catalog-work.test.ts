/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperVisualInspectorModel } from '../src/common/editor/ui/framescaper-visual-inspector-model.ts';
import { normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';

test('the visual inspector normalizes each mask once per model generation', () => {
	const masks = Array.from({ length: 50 }, (_, i) => ({ schemaVersion: 1, id: `mask-${i}`, kind: 'mask', inputs: [], nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: 0.1, y: 0.2, width: 0.6, height: 0.5 }], outputNodeId: 'shape' }));
	const members = new Set<unknown>(masks);
	const original = Object.getOwnPropertyDescriptor;
	let reads = 0;
	Object.getOwnPropertyDescriptor = (value, key) => { if (members.has(value)) reads++; return original(value, key); };
	try {
		const model = createFramescaperVisualInspectorModel({ project: { schemaFamily: 'framescaper', schemaVersion: 1, clips: [], sources: [], videoVisualPresets: [], videoMaskMattes: masks } });
		assert.equal(model.masks.length, 50);
		assert.ok(model.masks.every(mask => mask.width === 0.6));
		assert.ok(reads < masks.length * 20, `${reads} mask field reads`);
	} finally { Object.getOwnPropertyDescriptor = original; }
});

test('saved generator presets fingerprint each source only once', () => {
	const sources = Array.from({ length: 20 }, (_, i) => normalizeVideoGeneratorSourceV1({ schemaVersion: 1, id: `source-${i}`, kind: 'generator', name: `Solid ${i}`, width: 1920, height: 1080, frameRate: { num: 24, den: 1 }, frameCount: 240, generator: { kind: 'solid', color: '#ffffffff' } }));
	const presets = sources.map((source, i) => ({ schemaVersion: 1, kind: 'video-preset', id: `preset-${i}`, name: `Preset ${i}`, modelKind: 'generator', authoredStateSha256: fingerprintNativeMediaPlan(source).sha256 }));
	const original = TextEncoder.prototype.encode;
	let fingerprints = 0;
	TextEncoder.prototype.encode = function (value?: string) { if (value?.includes('"kind":"generator"')) fingerprints++; return original.call(this, value); };
	try {
		const model = createFramescaperVisualInspectorModel({ project: { schemaFamily: 'framescaper', schemaVersion: 1, clips: [], sources, videoVisualPresets: presets, videoMaskMattes: [] } });
		assert.equal(model.presets.length, 20);
		assert.equal(fingerprints, 20);
	} finally { TextEncoder.prototype.encode = original; }
});
