/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { selectedTranscriptWords, transcriptCaretWord } from '../src/common/editor/ui/workspace/transcript-dom-selection.ts';
import type { TranscriptEditingWord } from '../src/common/editor/transcript-editing.ts';

test('transcript deletion resolves both sides of spaces and paragraph boundaries', context => {
	const dom = new JSDOM('<div><p><span contenteditable="false">Track</span><span><span data-transcript-word="one">One</span> </span><span><span data-transcript-word="two">two</span> </span></p></div>');
	context.after(() => dom.window.close());
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'Node');
	Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, 'Node', previous);
		else Reflect.deleteProperty(globalThis, 'Node');
	});
	const root = dom.window.document.querySelector('div')!;
	const spans = root.querySelectorAll<HTMLElement>('[data-transcript-word]');
	const words: readonly TranscriptEditingWord[] = ['one', 'two'].map((id, index) => ({ id, text: spans[index]!.textContent!,
		speaker: null, trackId: 'track', trackName: 'Track', clipId: 'clip', startFrame: index * 100,
		endFrame: (index + 1) * 100, granularity: 'word', locked: false }));
	const caret = (node: Node, offset: number) => {
		const selection = dom.window.getSelection()!;
		selection.collapse(node, offset);
		return ['backward', 'forward'].map(direction => transcriptCaretWord(root, words, direction as 'backward' | 'forward')?.id ?? null);
	};
	assert.deepEqual(caret(spans[0]!.nextSibling!, 1), ['one', 'two']);
	assert.deepEqual(caret(spans[0]!.parentNode!, 1), ['one', 'two']);
	assert.deepEqual(caret(root.firstChild!, 1), [null, 'one']);
	assert.deepEqual(caret(root.firstChild!, 3), ['two', null]);
	assert.deepEqual(caret(spans[0]!, 1), ['one', 'two']);
	assert.deepEqual(caret(spans[1]!.firstChild!, 0), ['one', 'two']);
});

test('a selection inside one word skips the transcript-wide DOM query', context => {
	const dom = new JSDOM('<div id="passage"><p><span data-transcript-word="one">First</span></p><p><span data-transcript-word="two">Second</span></p></div>');
	context.after(() => dom.window.close());
	const root = dom.window.document.querySelector<HTMLElement>('#passage')!;
	const word = root.querySelector('[data-transcript-word="two"]')!;
	const range = dom.window.document.createRange();
	range.setStart(word.firstChild!, 1);
	range.setEnd(word.firstChild!, 3);
	dom.window.getSelection()!.addRange(range);
	root.querySelectorAll = () => assert.fail('single-word selection must stay inside that word');
	const words = [{ id: 'one' }, { id: 'two' }] as TranscriptEditingWord[];
	assert.deepEqual(selectedTranscriptWords(root, words), [words[1]]);
});
