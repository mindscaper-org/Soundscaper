/* SPDX-License-Identifier: AGPL-3.0-only */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { iconNameToChar } from '../../audacity-iconcodes.js';
import type { CustomToolbarButtonAction } from '../toolbar/custom-toolbar-button-actions.ts';
import { prepareCustomToolbarActionSearch } from './custom-toolbar-button-search.ts';

interface Props {
	readonly actions: readonly CustomToolbarButtonAction[];
	readonly actionId: string;
	readonly copy: Record<string, string>;
	readonly disabled: boolean;
	readonly onSelect: (actionId: string) => void;
}

export default function CustomToolbarActionPicker({ actions, actionId, copy, disabled, onSelect }: Props) {
	const listId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(-1);
	const expanded = open && !disabled;
	const findActions = useMemo(() => prepareCustomToolbarActionSearch(actions), [actions]);
	const matches = findActions(query ?? '');
	const selected = actions.find((action) => action.actionId === actionId);
	const choose = (action: CustomToolbarButtonAction) => {
		onSelect(action.actionId);
		setQuery(null);
		setOpen(false);
		setActive(-1);
	};
	useEffect(() => {
		if (expanded && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
	}, [active, expanded]);
	return <div className="kw-audio-editor-custom-button-dialog__action-picker" onBlur={(event) => {
		if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(null); }
	}} onKeyDown={(event) => {
		if (disabled || event.nativeEvent.isComposing) return;
		if (event.key === 'Escape' && open) {
			event.preventDefault(); event.stopPropagation(); setOpen(false);
		} else if (event.target !== inputRef.current) return;
		else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault(); setOpen(true);
			setActive(matches.length ? active < 0
				? event.key === 'ArrowDown' ? 0 : matches.length - 1
				: (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : -1);
		} else if (event.key === 'Enter' && open) {
			event.preventDefault();
			const action = matches[active];
			if (action) choose(action);
		}
	}}>
		<label className="kw-audio-editor-custom-button-dialog__field">
			<span>{copy.customToolbarButtonAction}</span>
			<input ref={inputRef} type="text" role="combobox" aria-label={copy.customToolbarButtonActionSearch}
				aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
				aria-activedescendant={expanded && active >= 0 && matches[active] ? `${listId}-${active}` : undefined}
				placeholder={copy.customToolbarButtonActionSearch} disabled={disabled}
				value={query ?? selected?.path.join(' › ') ?? actionId}
				onChange={(event) => {
					const value = event.currentTarget.value;
					setQuery(value); onSelect(''); setActive(-1);
					setOpen(value.trim().length >= 3 || findActions(value).length < 10);
				}} />
		</label>
		<button type="button" className="kw-audio-editor-custom-button-dialog__action-toggle"
			aria-label={copy.customToolbarButtonShowActions} aria-expanded={expanded} aria-controls={listId} disabled={disabled}
			onMouseDown={(event) => event.preventDefault()}
			onClick={() => { setQuery(''); setActive(-1); setOpen(!open); inputRef.current?.focus(); }}>
			<span className="musescore-icon" aria-hidden="true">{iconNameToChar('ARROW_DOWN')}</span>
		</button>
		{expanded && <div className="kw-audio-editor-custom-button-dialog__action-results">
			<div ref={listRef} id={listId} role="listbox" aria-label={copy.customToolbarButtonAction}>
				{matches.map((action, index) => <div key={action.actionId} id={`${listId}-${index}`} role="option"
					aria-selected={action.actionId === actionId} data-active={index === active}
					onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)}
					onClick={() => choose(action)}>{action.path.join(' › ')}</div>)}
			</div>
			{matches.length === 0 && <p role="status">{copy.customToolbarButtonNoActions}</p>}
		</div>}
	</div>;
}
