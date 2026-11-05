/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DraftBlurCommitGuard {
	cancelNextBlur: boolean;
}

interface DraftFieldTarget {
	blur(): void;
}

interface DraftFieldEscapeEvent<Target extends DraftFieldTarget> {
	readonly currentTarget: Target;
	preventDefault(): void;
	stopPropagation(): void;
}

export function createDraftBlurCommitGuard(): DraftBlurCommitGuard {
	return { cancelNextBlur: false };
}

export function draftBlurShouldCommit(guard: DraftBlurCommitGuard): boolean {
	if (!guard.cancelNextBlur) return true;
	guard.cancelNextBlur = false;
	return false;
}

export function cancelDraftEditOnEscape<Target extends DraftFieldTarget>(
	guard: DraftBlurCommitGuard,
	event: DraftFieldEscapeEvent<Target>,
	restore: () => void,
): void {
	guard.cancelNextBlur = true;
	restore();
	event.preventDefault();
	event.stopPropagation();
	event.currentTarget.blur();
}

/** Let native blur publish a focused draft before pointer selection removes its field. */
export function retainDraftBlurBeforePointerSelection(input: HTMLInputElement): () => void {
	const document = input.ownerDocument;
	const beforeSelection = (event: PointerEvent): void => {
		if (event.button === 0 && event.isPrimary !== false && event.target !== input
			&& document.activeElement === input) input.blur();
	};
	document.addEventListener('pointerdown', beforeSelection, true);
	return () => { document.removeEventListener('pointerdown', beforeSelection, true); };
}
