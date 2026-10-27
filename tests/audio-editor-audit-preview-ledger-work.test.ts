/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { beginVideoPreviewRenderLedger, completeVideoPreviewRenderLedger,
	recordVideoPreviewEntryRendered, recordVideoPreviewEntryFallback, recordVideoPreviewLayerRendered,
} from '../src/common/editor/ui/video-preview-render-ledger.js';

test('preview accounting visits only states owned by the rendered entry or layer', () => {
	const count = 500;
	const layers = Array.from({ length: count }, (_, index) => ({ blendMode: 'normal',
		entries: [{ clipId: `clip-${index}`, renderDescription: { kind: 'generator' },
			effects: [{ id: `effect-${index}`, type: 'color-adjust', enabled: true }] }],
		effects: [{ id: `layer-effect-${index}`, type: 'pixelate', enabled: true }],
	}));
	const ledger = beginVideoPreviewRenderLedger(layers, new Set(['color-adjust', 'pixelate']));
	let visits = 0;
	for (const map of [ledger.effects, ledger.composition]) {
		const values = map.values.bind(map);
		map.values = function* () { for (const value of values()) { visits++; yield value; } return undefined; };
	}
	for (const [index, layer] of layers.entries()) {
		if (index === 0) recordVideoPreviewEntryFallback(ledger, layer.entries[0]);
		else recordVideoPreviewEntryRendered(ledger, layer.entries[0]);
		recordVideoPreviewLayerRendered(ledger, layer);
	}
	const result = completeVideoPreviewRenderLedger(ledger, count, 'available');
	assert.equal(result.effects.rendered.length, count * 2 - 1);
	assert.deepEqual(result.effects.fallbackRendered, ['effect-0']);
	assert.deepEqual(result.effects.omitted, []);
	assert.equal(result.composition?.requested.length, count);
	assert.equal(result.composition?.rendered.length, count - 1);
	assert.deepEqual(result.composition?.omitted, ['clip-0']);
	assert.ok(visits <= count * 4, `${visits} unrelated ledger state visits`);
});
