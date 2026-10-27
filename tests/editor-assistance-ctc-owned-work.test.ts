/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { alignAssistanceCtcWordsV1 } from '../src/common/editor/assistance/ctc-forced-alignment-v1.ts';
import { splitAssistanceWav2Vec2EnglishSegmentWordsV1, tokenizeAssistanceWav2Vec2EnglishWordV1, ASSISTANCE_WAV2VEC2_BASE_960H_VOCABULARY_V1 } from '../src/common/editor/assistance/wav2vec2-english-tokenizer-v1.ts';

test('a real30-second90-word alignment reuses two score rows and contiguous token ownership', (context) => {
	const words = splitAssistanceWav2Vec2EnglishSegmentWordsV1(Array.from({ length: 90 }, () => 'hello').join(' '))
		.map((text, wordIndex) => ({ segmentIndex: 0, wordIndex, text, tokenIds: tokenizeAssistanceWav2Vec2EnglishWordV1(text) }));
	const frameCount = 1499, vocabularySize = ASSISTANCE_WAV2VEC2_BASE_960H_VOCABULARY_V1.length;
	const stateCount = words.reduce((count, word) => count + word.tokenIds.length, 0) * 2 + 1;
	const original = Float64Array, push = Array.prototype.push;
	let scoreRows = 0, tokenArrayPushes = 0;
	globalThis.Float64Array = new Proxy(original, { construct(target, args) {
		if (args[0] === stateCount) scoreRows += 1;
		return Reflect.construct(target, args, target) as Float64Array;
	} });
	Object.defineProperty(Array.prototype, 'push', { configurable: true, writable: true,
		value: function (this: unknown[], ...values: unknown[]) {
			if (values.length === 1 && typeof values[0] === 'number' && new Error().stack?.includes('alignedWords')) tokenArrayPushes += 1;
			return Reflect.apply(push, this, values) as number;
		} });
	context.after(() => {
		globalThis.Float64Array = original;
		Object.defineProperty(Array.prototype, 'push', { configurable: true, writable: true, value: push });
	});
	const result = alignAssistanceCtcWordsV1({ schemaVersion: 1, sampleRate: 16000, frameStrideSamples: 320,
		blankTokenId: 0, vocabularySize, frameCount, emissionLogProbabilities: new Float32Array(frameCount * vocabularySize).fill(-Math.log(vocabularySize)), words });
	assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), 'f35afb5b964315450d58a6b4358c3c608e35884c698144540331ebc89327ead4');
	assert.equal(scoreRows, 2);
	assert.equal(tokenArrayPushes, 0);
});
