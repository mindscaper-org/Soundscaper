/* SPDX-License-Identifier: AGPL-3.0-only */
import type { TranscriptEditingWord } from '../../transcript-editing.ts';

const WORD_SELECTOR = '[data-transcript-word]';

export function indexTranscriptWordPositions(words: readonly TranscriptEditingWord[]): ReadonlyMap<string, number> | null {
	const positions = new Map<string, number>();
	for (const [index, word] of words.entries()) {
		if (positions.has(word.id)) return null;
		positions.set(word.id, index);
	}
	return positions;
}

/** Count only selected text, excluding a word touched at an empty range edge. */
export function selectedTranscriptWords(root: HTMLElement, words: readonly TranscriptEditingWord[],
	positions?: ReadonlyMap<string, number> | null): readonly TranscriptEditingWord[] {
	const selection = root.ownerDocument.getSelection();
	if (!selection?.rangeCount || selection.isCollapsed || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return [];
	const range = selection.getRangeAt(0), ids = new Set<string>();
	const common = elementAt(range.commonAncestorContainer);
	const ancestor = common && root.contains(common) ? common : root;
	const containingWord = ancestor.closest<HTMLElement>(WORD_SELECTOR);
	if (containingWord && root.contains(containingWord)) {
		if (range.toString().length) ids.add(containingWord.dataset.transcriptWord!);
	} else for (const element of ancestor.querySelectorAll<HTMLElement>(WORD_SELECTOR)) {
		if (!range.intersectsNode(element)) continue;
		const end = element.childNodes.length;
		const startPosition = range.comparePoint(element, 0);
		const endPosition = range.comparePoint(element, end);
		if (startPosition === 0 && endPosition === 0) {
			if (element.textContent?.length) ids.add(element.dataset.transcriptWord!);
			continue;
		}
		const intersection = range.cloneRange();
		if (startPosition === 0) intersection.setStart(element, 0);
		if (endPosition === 0) intersection.setEnd(element, end);
		if (intersection.toString().length) ids.add(element.dataset.transcriptWord!);
	}
	if (positions && ids.size * 2 < words.length) {
		const indices: number[] = [];
		for (const id of ids) {
			const index = positions.get(id);
			if (index !== undefined) indices.push(index);
		}
		indices.sort((left, right) => left - right);
		return indices.map(index => words[index]!);
	}
	return words.filter(word => ids.has(word.id));
}

export function transcriptCaretWord(root: HTMLElement, words: readonly TranscriptEditingWord[], direction: 'forward' | 'backward',
	positions?: ReadonlyMap<string, number> | null) {
	const selection = root.ownerDocument.getSelection();
	const anchor = selection?.anchorNode;
	if (!anchor || !root.contains(anchor)) return null;
	const span = elementAt(anchor)?.closest<HTMLElement>(WORD_SELECTOR);
	const index = span ? wordPosition(words, span, positions) : -1;
	if (span && index >= 0) {
		const before = root.ownerDocument.createRange();
		before.selectNodeContents(span);
		before.setEnd(anchor, selection!.anchorOffset);
		const precedingLength = before.toString().length;
		if (direction === 'backward' && !precedingLength) return words[index - 1] ?? null;
		if (direction === 'forward' && precedingLength === span.textContent?.length) return words[index + 1] ?? null;
		return words[index] ?? null;
	}
	// Native arrow navigation also places the caret in separator text and at
	// paragraph boundaries. Find the word on the requested side of that point.
	const spans = root.querySelectorAll<HTMLElement>(WORD_SELECTOR);
	const content = root.ownerDocument.createRange();
	const backward = direction === 'backward';
	for (let offset = 0; offset < spans.length; offset += 1) {
		const candidate = spans[backward ? spans.length - 1 - offset : offset]!;
		content.selectNodeContents(candidate);
		const position = content.comparePoint(anchor, selection!.anchorOffset);
		if (position === (backward ? 1 : -1)) return words[wordPosition(words, candidate, positions)] ?? null;
	}
	return null;
}

export function findTranscriptWordElement(root: HTMLElement, id: string): HTMLElement | null {
	const escape = root.ownerDocument.defaultView?.CSS?.escape;
	if (escape) return root.querySelector<HTMLElement>(`[data-transcript-word="${escape(id)}"]`);
	for (const element of root.querySelectorAll<HTMLElement>(WORD_SELECTOR)) {
		if (element.dataset.transcriptWord === id) return element;
	}
	return null;
}

function wordPosition(words: readonly TranscriptEditingWord[], element: HTMLElement, positions?: ReadonlyMap<string, number> | null): number {
	const id = element.dataset.transcriptWord!;
	return positions ? positions.get(id) ?? -1 : words.findIndex(word => word.id === id);
}

function elementAt(node: Node): Element | null {
	return node.nodeType === 1 ? node as Element : node.parentElement;
}
