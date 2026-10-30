import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TimeCodeProps } from './TimeCode';
import { formatTimeText, parseTimeText } from './time-code-text';

interface TextEntryProps extends Pick<TimeCodeProps, 'value' | 'format' | 'sampleRate' | 'frameRate' | 'disabled' | 'ariaLabel' | 'onChange' | 'onTextChange' | 'onCommit'> {
	containerRef: React.RefObject<HTMLDivElement | null>;
}

/** Double click or the format menu opts into one selected, free text field. */
export function useTimeCodeText({ value, format = 'hh:mm:ss', sampleRate = 44100, frameRate = 24, disabled, ariaLabel, onChange, onTextChange, onCommit, containerRef }: TextEntryProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const editing = draft !== null;
	const commitPending = useRef(false);
	useLayoutEffect(() => {
		if (commitPending.current) { commitPending.current = false; onCommit?.(); }
		if (!editing) return;
		inputRef.current?.focus();
		inputRef.current?.select?.();
	}, [editing, onCommit]);
	const begin = useCallback(() => {
		if (disabled || !onChange) return;
		setDraft(formatTimeText(value, format, sampleRate, frameRate));
	}, [disabled, onChange, format, value, sampleRate, frameRate]);
	useEffect(() => {
		const host = containerRef.current;
		host?.addEventListener('timecode-enter-value', begin);
		return () => host?.removeEventListener('timecode-enter-value', begin);
	}, [begin, containerRef]);
	const parseDraft = (text: string) => parseTimeText(onTextChange ? text.trim().replace(/^[+-]/u, '') : text, format, sampleRate, frameRate);
	const cancel = () => { setDraft(null); containerRef.current?.focus(); };
	return {
		begin,
		input: draft === null ? null : <input
			ref={inputRef}
			className="timecode__free-text"
			aria-label={ariaLabel}
			aria-invalid={parseDraft(draft) === null}
			value={draft}
			onChange={event => setDraft(event.currentTarget.value)}
			onBlur={() => setDraft(null)}
			onClick={event => event.stopPropagation()}
			onDoubleClick={event => event.stopPropagation()}
			onKeyDown={event => {
				event.stopPropagation();
				if (event.key === 'Escape') { event.preventDefault(); cancel(); }
				if (event.key !== 'Enter') return;
				event.preventDefault();
				const parsed = parseDraft(draft);
				if (parsed === null) return;
				if (onTextChange) onTextChange(parsed, draft.trim().startsWith('-') ? '-' : draft.trim().startsWith('+') ? '+' : null);
				else onChange?.(parsed);
				commitPending.current = true;
				cancel();
			}}
		/>,
	};
}
