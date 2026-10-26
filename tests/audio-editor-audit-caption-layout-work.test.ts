/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fitBurnInTexts } from '../src/common/editor/video-caption-line-wrap.ts';

test('caption font fitting segments a job once while retaining exact Unicode wrapping and rounded advances', () => {
	const text = 'Captions preserve cafés, Á, emoji 👩‍💻 and long words antidisestablishmentarianism. '.repeat(3);
	const expected = 'Captions preserve cafés, Á, emoji 👩‍💻\nand long words antidisestablishmentarianism.\n'.repeat(3).trimEnd();
	const original = Intl.Segmenter;
	let constructors = 0;
	let segmentCalls = 0;
	Intl.Segmenter = new Proxy(original, { construct(target, args: ConstructorParameters<typeof Intl.Segmenter>) {
		constructors++;
		const segmenter = new target(...args);
		const segment = segmenter.segment.bind(segmenter);
		segmenter.segment = input => { segmentCalls++; return segment(input); };
		return segmenter;
	} });
	try {
		const fitted = fitBurnInTexts(Array.from({ length: 200 }, () => text), 720, 300, 24, 48);
		assert.equal(fitted.fontSizePx, 27);
		assert.equal(fitted.lineSpacingPx, 7);
		assert.equal(fitted.texts.length, 200);
		assert.ok(fitted.texts.every(caption => caption === expected));
		assert.equal(constructors, 1);
		assert.ok(segmentCalls <= 10, 'repeated words and font trials reuse job-owned graphemes');
	} finally { Intl.Segmenter = original; }
});
