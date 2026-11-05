/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Request {
	readonly control: HTMLButtonElement;
	readonly revision: number;
	readonly owner: unknown;
}

/** A completed Create clears its own draft and disables its former focus target. */
export function useWorkspaceCreationFocus(input: RefObject<HTMLInputElement | null>, name: string,
	revision: number, owner: unknown) {
	const request = useRef<Request | null>(null);
	useLayoutEffect(() => {
		const captured = request.current;
		if (!captured) return;
		if (!Object.is(captured.owner, owner) || captured.revision !== revision) { request.current = null; return; }
		if (name !== '') return;
		request.current = null;
		const document = captured.control.ownerDocument;
		if (document.activeElement !== captured.control && document.activeElement !== document.body) return;
		input.current?.focus({ preventScroll: true });
	}, [input, name, owner, revision]);
	return (control: HTMLButtonElement | undefined, submittedRevision: number): void => {
		request.current = control && control.ownerDocument.activeElement === control
			? { control, revision: submittedRevision, owner } : null;
	};
}
