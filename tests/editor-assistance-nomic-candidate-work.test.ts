/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistanceNomicTokenizerV1 } from '../src/common/editor/assistance/nomic-tokenizer-v1.ts';
import { nomicTokenizerArtifactFixture } from './assistance-nomic-tokenizer-fixture.ts';

test('greedy WordPiece uses code point boundaries without candidate character-array joins', (context) => {
	const tokenizer = createAssistanceNomicTokenizerV1(nomicTokenizerArtifactFixture());
	const join = Array.prototype.join; let candidateJoins = 0;
	Object.defineProperty(Array.prototype, 'join', { configurable: true, writable: true,
		value: function (this: unknown[], separator?: string) {
			if (new Error().stack?.includes('appendWordPiece')) candidateJoins += 1;
			return join.call(this, separator);
		} });
	context.after(() => Object.defineProperty(Array.prototype, 'join', { configurable: true, writable: true, value: join }));
	assert.deepEqual(tokenizer.encode(Array.from({ length: 100 }, () => 'e'.repeat(100)).join(' ')), new Array<number>(100).fill(100));
	assert.deepEqual(tokenizer.encode('Héllo, cafés! Éİ a\u{2b820}b a\u{2b920}b'), [7592, 1010, 7668, 2015, 999, 1041, 2072, 100, 1037, 100, 1038]);
	assert.deepEqual(tokenizer.encode('a'.repeat(101)), [100]);
	assert.equal(candidateJoins, 0);
});
