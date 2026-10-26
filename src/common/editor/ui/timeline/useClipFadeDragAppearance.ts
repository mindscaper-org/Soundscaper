/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface Drag {
	readonly pointerId: number;
	readonly target: HTMLElement;
	readonly clipId: string;
	readonly edge: string;
	readonly shape: boolean;
}

/** Presentation follows the native timeline session; it never commits an edit. */
export function useClipFadeDragAppearance(blocked: boolean, rootRef: RefObject<HTMLDivElement | null>) {
	const [drag, setDrag] = useState<Drag | null>(null);
	const current = useRef<Drag | null>(null);
	const clear = useCallback(() => {
		if (!current.current) return;
		current.current = null;
		setDrag(null);
	}, []);
	useEffect(() => {
		if (!drag) return;
		const document = drag.target.ownerDocument;
		const end = (event: PointerEvent) => {
			if (event.pointerId !== drag.pointerId) return;
			if (event.type === 'pointerup' && event.pointerType === 'mouse' && event.button !== 0) return;
			if (event.type === 'pointermove' && (event.pointerType !== 'mouse' || (event.buttons & 1))) return;
			clear();
		};
		const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointermove'] as const) document.addEventListener(type, end, true);
		document.addEventListener('keydown', escape, true);
		return () => {
			for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointermove'] as const) document.removeEventListener(type, end, true);
			document.removeEventListener('keydown', escape, true);
		};
	}, [clear, drag]);
	const start = useCallback((event: PointerEvent) => {
		if (blocked || event.button !== 0 || current.current) return;
		if (!(event.target instanceof Element) || !rootRef.current?.contains(event.target)) return;
		const target = event.target.closest<HTMLElement>('[data-clip-fade-handle], [data-clip-fade-shape-handle]');
		const clipId = target?.closest<HTMLElement>('[data-clip-id]')?.dataset.clipId;
		if (!target || !clipId) return;
		const shape = target.dataset.clipFadeShapeHandle !== undefined;
		const next = { pointerId: event.pointerId, target, clipId,
			edge: (shape ? target.dataset.clipFadeShapeHandle : target.dataset.clipFadeHandle)!, shape };
		current.current = next;
		setDrag(next);
	}, [blocked, rootRef]);
	useEffect(() => {
		const document = rootRef.current?.ownerDocument;
		if (!document) return;
		// The native timeline claims fade presses in ancestor capture and stops
		// propagation. Observe first without consuming or changing its edit session.
		document.addEventListener('pointerdown', start, true);
		return () => document.removeEventListener('pointerdown', start, true);
	}, [rootRef, start]);
	return drag;
}
