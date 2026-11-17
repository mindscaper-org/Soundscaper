/* SPDX-License-Identifier: AGPL-3.0-only */
import type { TranscriptEditingWord } from '../../transcript-editing.ts';

/** Count only selected text, excluding a word touched at an empty range edge. */
export function selectedTranscriptWords(root: HTMLElement, words: readonly TranscriptEditingWord[]): readonly TranscriptEditingWord[] {
	const selection = root.ownerDocument.getSelection();
	if (!selection?.rangeCount || selection.isCollapsed || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return [];
	const range = selection.getRangeAt(0), ids = new Set<string>();
	for (const element of root.querySelectorAll<HTMLElement>('[data-transcript-word]')) {
		if (!range.intersectsNode(element)) continue;
		const content = root.ownerDocument.createRange();
		content.selectNodeContents(element);
		const intersection = range.cloneRange();
		if (intersection.compareBoundaryPoints(Range.START_TO_START, content) < 0) intersection.setStart(content.startContainer, content.startOffset);
		if (intersection.compareBoundaryPoints(Range.END_TO_END, content) > 0) intersection.setEnd(content.endContainer, content.endOffset);
		if (intersection.toString().length) ids.add(element.dataset.transcriptWord!);
	}
	return words.filter(word => ids.has(word.id));
}

export function transcriptCaretWord(root: HTMLElement, words: readonly TranscriptEditingWord[], direction: 'forward' | 'backward') {
	const selection = root.ownerDocument.getSelection();
	const anchor = selection?.anchorNode;
	if (!anchor || !root.contains(anchor)) return null;
	const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement;
	const span = element?.closest<HTMLElement>('[data-transcript-word]');
	const index = words.findIndex(word => word.id === span?.dataset.transcriptWord);
	if (span && index >= 0) {
		const before = root.ownerDocument.createRange();
		before.selectNodeContents(span);
		before.setEnd(anchor, selection!.anchorOffset);
		if (direction === 'backward' && !before.toString().length) return words[index - 1] ?? null;
		if (direction === 'forward' && before.toString().length === span.textContent?.length) return words[index + 1] ?? null;
		return words[index] ?? null;
	}
	// Native arrow navigation also places the caret in separator text and at
	// paragraph boundaries. Find the word on the requested side of that point.
	const spans = [...root.querySelectorAll<HTMLElement>('[data-transcript-word]')];
	if (direction === 'backward') spans.reverse();
	for (const candidate of spans) {
		const content = root.ownerDocument.createRange();
		content.selectNodeContents(candidate);
		const position = content.comparePoint(anchor, selection!.anchorOffset);
		if (position === (direction === 'backward' ? 1 : -1)) {
			return words.find(word => word.id === candidate.dataset.transcriptWord) ?? null;
		}
	}
	return null;
}
