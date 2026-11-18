/* SPDX-License-Identifier: AGPL-3.0-only */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import { TRANSCRIPT_EDITING_COPY_BY_LOCALE } from '../../../i18n/editor-transcript-editing-copy.ts';
import { transcriptAudioSelection, transcriptTextSelection, transcriptEditingGeometryKey, type TranscriptEditingWord } from '../../transcript-editing.ts';
import type { TranscriptEditingDocument } from '../../controller/composition/transcript-editing-actions.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { ProcessingButton as Button } from '../dialogs/ProcessingButton.tsx';
import { centeredTimelinePlayheadScroll } from './timeline-navigation-geometry.js';
import { findTranscriptWordElement, indexTranscriptWordPositions, selectedTranscriptWords, transcriptCaretWord } from './transcript-dom-selection.ts';
import type { TranscriptPanelController, TranscriptPanelSnapshot } from './transcript-editing-panel-types.ts';
import TranscriptGeneration from './TranscriptGeneration.tsx';
import './TranscriptEditingPanel.css';

interface Props {
	readonly controller: TranscriptPanelController;
	readonly snapshot: TranscriptPanelSnapshot;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale: string;
	readonly fileService: { readonly isDesktop: boolean; readonly bridge?: unknown };
	readonly blocked: boolean;
}

const EMPTY_WORDS: readonly TranscriptEditingWord[] = Object.freeze([]);
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

export default function TranscriptEditingPanel(props: Props) {
	return <TranscriptEditingSurface key={props.snapshot.project?.id ?? ''} {...props} />;
}

function TranscriptEditingSurface({ controller, snapshot, copy, locale, fileService, blocked }: Props) {
	const labels = useMemo(() => resolveEditorCopyScope('transcriptEditing', TRANSCRIPT_EDITING_COPY_BY_LOCALE.en, copy), [copy]);
	const [document, setDocument] = useState<TranscriptEditingDocument | null>(null);
	const [loading, setLoading] = useState(true);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = usePresentationFeedback(copy);
	const [refresh, setRefresh] = useState(0);
	const [generation, setGeneration] = useState<{ document: TranscriptEditingDocument; cancellation: AbortController } | null>(null);
	const [progress, setProgress] = useState({ completed: 0, total: 0 });
	const panel = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null);
	const pendingCaret = useRef<{ frame: number; trackId: string; direction: 'forward' | 'backward' } | null>(null);
	const deleteInput = useRef<((direction: 'forward' | 'backward') => void) | null>(null);
	const generationRef = useRef(generation);
	generationRef.current = generation;
	const words = document?.words ?? EMPTY_WORDS;
	const groups = useMemo(() => {
		const byClip = new Map<string, TranscriptEditingWord[]>();
		for (const word of words) {
			const group = byClip.get(word.clipId);
			if (group) group.push(word);
			else byClip.set(word.clipId, [word]);
		}
		return Array.from(byClip.entries());
	}, [words]);
	const wordPositions = useMemo(() => indexTranscriptWordPositions(words), [words]);
	const hasSegmentTiming = useMemo(() => words.some(word => word.granularity === 'segment'), [words]);
	const hasGenerationTargets = Boolean(document?.targets.length);
	const projectId = snapshot.project?.id;
	const geometry = useMemo(() => transcriptEditingGeometryKey(snapshot.project), [snapshot.project]);
	const disabled = blocked || snapshot.readOnly === true || removing || generation !== null;
	const selection = snapshot.project?.selection;
	const selected = useMemo(() => transcriptAudioSelection(words, selection), [words, selection]);
	const selectedByClip = useMemo(() => {
		const byClip = new Map<string, Set<string>>();
		for (const word of selected) {
			const group = byClip.get(word.clipId);
			if (group) group.add(word.id);
			else byClip.set(word.clipId, new Set([word.id]));
		}
		return byClip;
	}, [selected]);
	const live = useRef({ words, wordPositions, disabled });
	live.current = { words, wordPositions, disabled };

	useEffect(() => {
		let active = true;
		if (!projectId) { setDocument(null); setLoading(false); return undefined; }
		setLoading(true);
		void controller.actions.transcript.read(projectId).then(value => {
			if (active) {
				if (!value.words.length && root.current?.contains(root.current.ownerDocument.activeElement)) panel.current?.focus({ preventScroll: true });
				setDocument(value);
			}
		}).catch((cause: unknown) => { if (active) { setDocument(null); setError(feedbackFailure(cause)); } })
			.finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, [controller, projectId, geometry, refresh, setError]);
	useEffect(() => () => generationRef.current?.cancellation.abort(), []);

	const selectWords = useCallback((chosen: readonly TranscriptEditingWord[]) => {
		const selection = transcriptTextSelection(chosen);
		const current = controller.getSnapshot().project?.selection;
		if (selection && !(current?.startFrame === selection.startFrame && current.endFrame === selection.endFrame
			&& current.trackIds?.length === selection.trackIds.length && selection.trackIds.every(id => current.trackIds!.includes(id))
			&& current.clipIds?.length === selection.clipIds.length && selection.clipIds.every(id => current.clipIds!.includes(id)))) {
			controller.actions.timeline.setExactSelection(selection.startFrame, selection.endFrame,
			{ trackIds: selection.trackIds, clipIds: selection.clipIds, frequencyRange: null });
		}
	}, [controller]);
	useEffect(() => {
		const element = root.current;
		if (!element) return undefined;
		const onSelection = () => {
			if (live.current.disabled) return;
			const chosen = selectedTranscriptWords(element, live.current.words, live.current.wordPositions);
			if (chosen.length) selectWords(chosen);
		};
		const onBeforeInput = (event: InputEvent) => {
			event.preventDefault();
			if (event.inputType.startsWith('delete')) deleteInput.current?.(event.inputType.includes('Backward') ? 'backward' : 'forward');
		};
		element.ownerDocument.addEventListener('selectionchange', onSelection);
		element.addEventListener('beforeinput', onBeforeInput);
		return () => {
			element.ownerDocument.removeEventListener('selectionchange', onSelection);
			element.removeEventListener('beforeinput', onBeforeInput);
		};
	}, [selectWords]);
	useLayoutEffect(() => {
		const request = pendingCaret.current, element = root.current;
		if (!request || !element || loading || removing) return;
		pendingCaret.current = null;
		const backward = request.direction === 'backward';
		let target: TranscriptEditingWord | undefined;
		for (let offset = 0; offset < words.length; offset += 1) {
			const word = words[backward ? words.length - 1 - offset : offset]!;
			if (word.trackId !== request.trackId) continue;
			target = word;
			if (backward ? word.endFrame <= request.frame : word.startFrame >= request.frame) break;
		}
		if (!target) { panel.current?.focus({ preventScroll: true }); return; }
		const span = findTranscriptWordElement(element, target.id);
		if (!span?.firstChild) return;
		const range = element.ownerDocument.createRange();
		range.setStart(span.firstChild, target.endFrame <= request.frame ? span.textContent!.length : 0);
		range.collapse(true);
		element.focus({ preventScroll: true });
		const selection = element.ownerDocument.getSelection();
		selection?.removeAllRanges(); selection?.addRange(range);
	}, [document, loading, removing, words]);

	function jump(word: TranscriptEditingWord): void {
		if (disabled) return;
		controller.actions.timeline.setExactSelection(word.startFrame, word.startFrame,
			{ trackIds: [word.trackId], clipIds: [word.clipId], frequencyRange: null });
		controller.actions.transport.seek(word.startFrame);
		const scroll = root.current?.closest('.kw-audio-editor')?.querySelector<HTMLElement>('.audio-editor-timeline-scroll');
		if (scroll && snapshot.project) {
			scroll.scrollLeft = centeredTimelinePlayheadScroll(scroll, { positionFrame: word.startFrame,
				sampleRate: snapshot.project.sampleRate, pixelsPerSecond: snapshot.timeline?.pixelsPerSecond ?? 120 });
			scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
		}
	}

	function remove(direction: 'backward' | 'forward'): void {
		if (disabled || !document || !root.current) return;
		const native = selectedTranscriptWords(root.current, words, wordPositions);
		const selection = root.current.ownerDocument.getSelection();
		const hasCaret = selection?.isCollapsed && root.current.contains(selection.anchorNode);
		const caret = !native.length && hasCaret ? transcriptCaretWord(root.current, words, direction, wordPositions) : null;
		const chosen = native.length ? native : hasCaret ? caret ? [caret] : [] : selected;
		if (!chosen.length) return;
		const current = controller.getSnapshot().project;
		if (!current || current.id !== document.projectId) return;
		setError('');
		setRemoving(true);
		void controller.actions.transcript.remove(document.projectId, current.revision, chosen.map(word => word.id))
			.then(() => {
				pendingCaret.current = { frame: transcriptTextSelection(chosen)!.startFrame, trackId: chosen[0]!.trackId, direction };
				root.current?.ownerDocument.getSelection()?.removeAllRanges(); setRefresh(value => value + 1);
			})
			.catch((cause: unknown) => setError(feedbackFailure(cause))).finally(() => setRemoving(false));
	}
	deleteInput.current = remove;

	const finishGeneration = useCallback((cause?: unknown) => {
		setGeneration(null);
		setRefresh(value => value + 1);
		if (cause) setError(feedbackFailure(cause));
	}, [setError]);
	const cancelGeneration = useCallback(() => {
		generationRef.current?.cancellation.abort(); setGeneration(null);
	}, []);
	const onProgress = useCallback((completed: number, total: number) => setProgress({ completed, total }), []);

	return <div ref={panel} tabIndex={-1} className="kw-audio-editor__transcript-panel">
		{error && <p role="alert">{error}</p>}
		{generation ? <div role="status"><p>{labels.generating.replace('{completed}', String(progress.completed)).replace('{total}', String(progress.total))}</p>
			<Button onClick={cancelGeneration}>{labels.cancel}</Button>
			<TranscriptGeneration controller={controller} targets={generation.document.targets} signal={generation.cancellation.signal}
				bridgeScope={fileService.bridge} copy={copy} locale={locale} onProgress={onProgress}
				onDone={finishGeneration} onClose={cancelGeneration} />
		</div> : null}
		{loading && !words.length ? <p role="status">{labels.loading}</p> : null}
		{!loading && !generation && (!words.length || (fileService.isDesktop && hasGenerationTargets)) ? <div className="kw-audio-editor__transcript-empty">
			{!words.length ? <p>{hasGenerationTargets ? labels.empty : labels.noAudio}</p> : null}
			<Button disabled={disabled || !fileService.isDesktop || !hasGenerationTargets} onClick={() => {
				if (!document) return;
				setError(''); setProgress({ completed: 0, total: document.targets.length });
				setGeneration({ document, cancellation: new AbortController() });
			}}>{labels.generate}</Button>
			{!fileService.isDesktop && <p>{labels.desktopRequired}</p>}
		</div> : null}
		{words.length ? <>
			<p className="kw-audio-editor__transcript-help">{labels.instructions}</p>
			{hasSegmentTiming ? <p>{labels.segmentTiming}</p> : null}
		</> : null}
		<div ref={root} role="textbox" aria-label={labels.text} aria-multiline="true" aria-readonly={disabled}
			aria-busy={loading || removing} hidden={!words.length}
			tabIndex={0} contentEditable={!disabled} suppressContentEditableWarning spellCheck={false}
			className="kw-audio-editor__transcript-text"
			onPaste={event => event.preventDefault()}
			onCut={event => {
				if (!root.current) return;
				event.preventDefault();
				const chosen = selectedTranscriptWords(root.current, words, wordPositions);
				if (!chosen.length) return;
				event.clipboardData.setData('text/plain', chosen.map(word => word.text).join(' '));
				remove('forward');
			}}
			onKeyDown={event => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === 'Delete' || event.key === 'Backspace') {
					event.preventDefault(); event.stopPropagation(); remove(event.key === 'Backspace' ? 'backward' : 'forward');
				} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
					event.preventDefault(); event.stopPropagation();
					if (event.shiftKey) controller.actions.edit.redo(); else controller.actions.edit.undo();
				} else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey || event.key === 'Enter') event.preventDefault();
			}}
			onClick={event => {
				if (root.current && selectedTranscriptWords(root.current, words, wordPositions).length) return;
				const element = (event.target as Element).closest<HTMLElement>('[data-transcript-word]');
				const id = element?.dataset.transcriptWord;
				if (!id) return;
				const word = wordPositions ? words[wordPositions.get(id) ?? -1] : words.find(candidate => candidate.id === id);
				if (word) jump(word);
			}}>
			{groups.map(([clipId, group]) => <TranscriptPassage key={clipId} words={group} selected={selectedByClip.get(clipId) ?? EMPTY_IDS} />)}
		</div>
	</div>;
}

const TranscriptPassage = memo(function TranscriptPassage({ words, selected }: {
	readonly words: readonly TranscriptEditingWord[];
	readonly selected: ReadonlySet<string>;
}) {
	const trackName = words[0]!.trackName;
	return <p role="group" aria-label={trackName}>
		<span className="kw-audio-editor__transcript-track" contentEditable={false}>{trackName}</span>
		{words.map(word => <span key={word.id}><span data-transcript-word={word.id}
			className={selected.has(word.id) ? 'is-selected' : ''}
			title={word.speaker ?? undefined}>{word.text}</span>{' '}</span>)}
	</p>;
});
