interface EditingKey {
	readonly key: string;
	readonly defaultPrevented: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

interface EditingOwner {
	readonly notes: readonly { readonly note: { readonly id: number; readonly selected?: boolean } }[];
	retireDrag(): void;
	deleteNotes(ids: number[]): void;
	selectNotes(ids: number[], additive?: boolean): void;
}

/** Own ordinary note editing without consuming configured modified commands. */
export function handleNoteGridEditingKey(event: EditingKey, owner: EditingOwner): void {
	if (event.defaultPrevented) return;
	if (event.key === 'Delete' || event.key === 'Backspace') {
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
		event.stopPropagation();
		const selected = owner.notes.filter(entry => entry.note.selected).map(entry => entry.note.id);
		if (selected.length) { owner.retireDrag(); owner.deleteNotes(selected); }
	} else if (event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
		event.preventDefault(); event.stopPropagation();
		const unselected = owner.notes.filter(entry => !entry.note.selected).map(entry => entry.note.id);
		if (unselected.length) owner.selectNotes(unselected, true);
	}
}
