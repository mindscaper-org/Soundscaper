/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { createLatestFrameTask } from './animation-frame-coalescer.ts';

interface PointerFrameEvent { readonly pointerId: number; preventDefault(): void; }
interface PointerFrameSession { readonly kind: string; readonly pointerId?: number; readonly captureTarget?: Element; }

export function useTimelinePointerFrame<Event extends PointerFrameEvent>(
	handle: (event: Event) => void,
	pointerSession: RefObject<PointerFrameSession | null>,
	touchPointers: RefObject<ReadonlyMap<number, unknown>> | null,
	flushRef?: RefObject<((cancel?: boolean) => void) | null>,
) {
	const handleRef = useRef(handle);
	handleRef.current = handle;
	type Pending = Readonly<{ event: Event; session: PointerFrameSession | null }>;
	const taskRef = useRef<ReturnType<typeof createLatestFrameTask<Pending>> | null>(null);
	useEffect(() => {
		const task = createLatestFrameTask<Pending>(requestAnimationFrame, cancelAnimationFrame,
			({ event, session }) => { if (pointerSession.current === session) handleRef.current(event); });
		taskRef.current = task;
		if (flushRef) flushRef.current = task.flush;
		return () => {
			task.dispose(); taskRef.current = null;
			if (flushRef) flushRef.current = null;
		};
	}, [flushRef, pointerSession]);
	const onPointerMove = useCallback((event: Event) => {
		const session = pointerSession.current;
		if (session?.pointerId !== undefined && session.pointerId !== event.pointerId) return;
		const immediate = touchPointers?.current.has(event.pointerId)
			|| ['sample-pencil', 'fade', 'fade-shape', 'crossfade-shape'].includes(session?.kind ?? '');
		if (immediate || !flushRef || !taskRef.current) { handleRef.current(event); return; }
		if (session) event.preventDefault();
		taskRef.current.schedule({ event, session });
	}, [pointerSession, touchPointers]);
	useEffect(() => {
		const owner = globalThis.window;
		if (!owner) return;
		const forwardOutsideDrag = (event: PointerEvent): void => {
			const session = pointerSession.current;
			const target = session?.captureTarget;
			if (session?.kind !== 'move' || !target
				|| event.target instanceof Node && target.contains(event.target)) return;
			// Native outside events carry the same pointer fields consumed by the frame handler.
			onPointerMove(event as unknown as Event);
		};
		owner.addEventListener('pointermove', forwardOutsideDrag, true);
		return () => owner.removeEventListener('pointermove', forwardOutsideDrag, true);
	}, [onPointerMove, pointerSession]);
	return onPointerMove;
}
