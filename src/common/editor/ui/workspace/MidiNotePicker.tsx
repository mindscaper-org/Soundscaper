/* SPDX-License-Identifier: AGPL-3.0-only */

import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Flyout } from '@soundscaper/design-system/Flyout';
import type { MidiNote } from '../../midi-model.ts';
import EditorControlLabel from '../EditorControlLabel.tsx';

interface Props {
	readonly notes: readonly MidiNote[];
	readonly activeNote: MidiNote | undefined;
	readonly sampleRate: number;
	readonly copy: Readonly<{ selectedNote: string; noSelection: string; noteOption: string }>;
	readonly select: (id: string) => void;
}

const NATIVE_OPTION_LIMIT = 1024;
const VISIBLE_ROWS = 8;
const ROW_HEIGHT = 26;

export function MidiNotePicker(props: Props) {
	const { notes, activeNote, sampleRate, copy, select } = props;
	const dense = notes.length > NATIVE_OPTION_LIMIT;
	const options = useMemo(() => dense ? null : notes.map(note => (
		<MidiNoteOption key={note.id} note={note} format={copy.noteOption} sampleRate={sampleRate} />
	)), [copy.noteOption, dense, notes, sampleRate]);
	if (dense) return <DenseMidiNotePicker {...props} />;
	return <label><EditorControlLabel>{copy.selectedNote}</EditorControlLabel>
		<select value={activeNote?.id ?? ''} onChange={event => select(event.currentTarget.value)}>
			<option value="">{copy.noSelection}</option>
			{options}
		</select>
	</label>;
}

const MidiNoteOption = memo(function MidiNoteOption({ note, format, sampleRate }: {
	readonly note: MidiNote; readonly format: string; readonly sampleRate: number;
}) {
	return <option value={note.id}>{noteLabel(note, format, sampleRate)}</option>;
});

function noteLabel(note: MidiNote, format: string, sampleRate: number): string {
	return format.replace('{pitch}', String(note.pitch)).replace('{time}', (note.startFrame / sampleRate).toFixed(3));
}

/** Keep the full authored order reachable with a fixed-size option window. */
function DenseMidiNotePicker({ notes, activeNote, sampleRate, copy, select }: Props) {
	const listId = useId();
	const viewport = useRef<HTMLDivElement>(null);
	const search = useRef({ text: '', time: 0 });
	const [anchor, setAnchor] = useState<{ host: Element; x: number; y: number } | null>(null);
	const [cursor, setCursor] = useState(0);
	const [scrollTop, setScrollTop] = useState(0);
	const active = Math.min(cursor, notes.length);
	const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 1);
	const end = Math.min(notes.length + 1, first + VISIBLE_ROWS + 3);
	const label = (note: MidiNote | undefined) => note ? noteLabel(note, copy.noteOption, sampleRate) : copy.noSelection;
	const selectedAt = () => activeNote ? notes.findIndex(note => note.id === activeNote.id) + 1 : 0;
	const close = useCallback(() => { setAnchor(null); search.current.text = ''; }, []);
	const open = (button: HTMLButtonElement, index: number) => {
		button.focus({ preventScroll: true });
		const bounds = button.getBoundingClientRect();
		setCursor(index);
		setScrollTop(Math.min(index, notes.length + 1 - VISIBLE_ROWS) * ROW_HEIGHT);
		setAnchor({ host: button.closest('#kw-audio-editor-design-system') ?? button.ownerDocument.body,
			x: bounds.left + bounds.width / 2, y: bounds.bottom });
	};
	const choose = (index: number) => { select(notes[index - 1]?.id ?? ''); close(); };
	useLayoutEffect(() => {
		const list = viewport.current;
		if (anchor && list) revealOption(list, active);
	}, [active, anchor]);
	const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
		if (event.key === 'Tab') { close(); return; }
		const index = anchor ? active : selectedAt();
		let next: number;
		switch (event.key) {
			case 'Escape': if (anchor) { event.preventDefault(); event.stopPropagation(); close(); } return;
			case 'Enter': case ' ': if (anchor) { event.preventDefault(); event.stopPropagation(); choose(index); } return;
			case 'ArrowDown': next = event.altKey ? index : index + 1; break;
			case 'ArrowUp': next = index - 1; break;
			case 'PageDown': next = index + VISIBLE_ROWS; break;
			case 'PageUp': next = index - VISIBLE_ROWS; break;
			case 'Home': next = 0; break;
			case 'End': next = notes.length; break;
			default: {
				if (event.altKey || event.key.length !== 1) return;
				const { text, time } = search.current;
				const character = event.key.toLocaleLowerCase();
				const withinSequence = event.timeStamp - time < 750;
				const prefix = withinSequence && text !== character ? text + character : character;
				search.current = { text: prefix, time: event.timeStamp };
				next = index;
				for (let step = prefix.length === 1 ? 1 : 0; step < notes.length + 1; step += 1) {
					const candidate = (index + step) % (notes.length + 1);
					if (label(notes[candidate - 1]).toLocaleLowerCase().startsWith(prefix)) { next = candidate; break; }
				}
			}
		}
		event.preventDefault(); event.stopPropagation();
		next = Math.max(0, Math.min(notes.length, next));
		if (!anchor) open(event.currentTarget, next);
		else if (next !== active) setCursor(next);
		else if (viewport.current) revealOption(viewport.current, next);
	};
	return <label><EditorControlLabel>{copy.selectedNote}</EditorControlLabel>
		<button type="button" role="combobox" className="kw-audio-editor__midi-note-picker" aria-label={copy.selectedNote}
			aria-describedby={`${listId}-value`} aria-expanded={anchor !== null} aria-controls={anchor ? listId : undefined}
			aria-activedescendant={anchor && active >= first && active < end ? `${listId}-${active}` : undefined}
			onBlur={event => { if (anchor && event.relatedTarget && !viewport.current?.contains(event.relatedTarget)) close(); }}
			onPointerDown={event => { if (anchor) event.stopPropagation(); }}
			onClick={event => { if (anchor) close(); else open(event.currentTarget, selectedAt()); }} onKeyDown={keyDown}>
			<span id={`${listId}-value`}>{label(activeNote)}</span>
		</button>
		{anchor && createPortal(<Flyout id={listId} isOpen x={anchor.x} y={anchor.y} showArrow={false}
			role="listbox" ariaLabel={copy.selectedNote} closeOnEscape={false} onClose={close}>
			<div className="kw-audio-editor__midi-note-options" ref={viewport} style={{ height: VISIBLE_ROWS * ROW_HEIGHT }}
				onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
				<div style={{ position: 'relative', height: (notes.length + 1) * ROW_HEIGHT }}>
					{Array.from({ length: Math.max(0, end - first) }, (_, offset) => {
						const index = first + offset;
						const note = notes[index - 1];
						return <div role="option" key={index} id={`${listId}-${index}`} aria-selected={note?.id === activeNote?.id}
							aria-posinset={index + 1} aria-setsize={notes.length + 1} data-active={index === active}
							style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }} onMouseDown={event => event.preventDefault()}
							onClick={event => { event.preventDefault(); choose(index); }}>{label(note)}</div>;
					})}
				</div>
			</div>
		</Flyout>, anchor.host)}
	</label>;
}

function revealOption(list: HTMLDivElement, index: number): void {
	const top = index * ROW_HEIGHT;
	list.scrollTop = Math.min(top, Math.max(list.scrollTop, top + ROW_HEIGHT - list.clientHeight));
}
