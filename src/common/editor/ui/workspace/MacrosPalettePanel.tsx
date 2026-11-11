/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@soundscaper/design-system/Button';
import { Icon } from '@soundscaper/design-system/Icon';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { resolveMacroManagerCopy } from '../inspector/macro-manager-copy.ts';
import './MacrosPalettePanel.css';

export interface MacrosPaletteEntry {
	readonly id: string;
	readonly name: string;
	readonly kind: 'steps' | 'script';
	readonly runnable: boolean;
}

interface MacrosPalettePanelProps {
	readonly entries: readonly MacrosPaletteEntry[];
	readonly copy: Readonly<Record<string, string>>;
	readonly libraryReadOnly: boolean;
	readonly onCreate: () => void;
	readonly onManage: (entry?: MacrosPaletteEntry) => void;
	readonly onRun: (entry: MacrosPaletteEntry) => void;
	readonly onDelete: (entry: MacrosPaletteEntry) => void;
}

/** A compact launcher; editing remains in the separate Macro manager dialog. */
export default function MacrosPalettePanel({ entries, copy, libraryReadOnly, onCreate, onManage, onRun, onDelete }: MacrosPalettePanelProps) {
	const root = useRef<HTMLDivElement>(null);
	const [menu, setMenu] = useState<{ x: number; y: number; key: string | null } | null>(null);
	const managerCopy = resolveMacroManagerCopy(undefined, copy);
	const entryKey = (entry: MacrosPaletteEntry) => `${entry.kind}:${entry.id}`;
	const menuEntry = entries.find((entry) => entryKey(entry) === menu?.key);
	const menuHost = root.current?.closest('[data-audio-editor]');
	const options = (key: string | null, label: string) => <button type="button"
		className="audio-editor-macro-launcher__options" aria-label={label} aria-haspopup="menu"
		aria-expanded={menu?.key === key && Boolean(menu)}
		onClick={(event) => {
			const bounds = event.currentTarget.getBoundingClientRect();
			setMenu({ x: bounds.left, y: bounds.bottom, key });
		}}><Icon name="menu" size={16} /></button>;
	const closeMenu = () => setMenu(null);
	return <div ref={root} className="audio-editor-macro-launcher" role="region" aria-label={copy.macrosPalette}>
		<header className="audio-editor-macro-launcher__header">
			<strong>{copy.macros}</strong>
			<Button variant="primary" icon={<Icon name="plus" size={16} />} disabled={libraryReadOnly} onClick={onCreate}>{copy.newMacro}</Button>
			{options(null, managerCopy.paletteOptions)}
		</header>
		{!entries.length && <p className="kw-audio-editor__panel-empty">{copy.macroLibraryEmpty}</p>}
		<ul className="audio-editor-macro-launcher__list" aria-label={copy.macros}>
			{entries.map((entry) => <li key={entryKey(entry)} aria-label={entry.name}>
				<button type="button" className="audio-editor-macro-launcher__name" onClick={() => onManage(entry)}>{entry.name}</button>
				<Button variant="secondary" icon={<Icon name="play" size={14} />} disabled={!entry.runnable} onClick={() => onRun(entry)}>{managerCopy.run}</Button>
				{options(entryKey(entry), `${managerCopy.macroOptions}: ${entry.name}`)}
			</li>)}
		</ul>
		{menu && menuHost && (menu.key === null || menuEntry) && createPortal(<ContextMenu isOpen x={menu.x} y={menu.y} onClose={closeMenu}>
			<ContextMenuItem label={menuEntry ? managerCopy.editMacro : copy.macroManager} onClick={() => { closeMenu(); onManage(menuEntry); }} />
			{menuEntry && <ContextMenuItem label={menuEntry.kind === 'script' ? managerCopy.deleteProgram : copy.deleteMacro} disabled={libraryReadOnly}
				onClick={() => { closeMenu(); onDelete(menuEntry); }} />}
		</ContextMenu>, menuHost)}
	</div>;
}
