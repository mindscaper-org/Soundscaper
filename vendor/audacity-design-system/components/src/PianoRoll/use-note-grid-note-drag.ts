/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Retire a held note edit when its authoring owner invalidates it. */
export function useNoteGridNoteDrag<Drag>(revision: number | undefined) {
  const dragRef = useRef<Drag | null>(null);
  const [gridCursor, setGridCursor] = useState('crosshair');
  const [dragPitch, setDragPitch] = useState<number | null>(null);
  const lastPlayedPitchRef = useRef<number | null>(null);
  const releaseGesture = useRef<() => void>(() => {});
  const cancelNoteDrag = useCallback(() => {
    releaseGesture.current();
    dragRef.current = null;
    setDragPitch(null);
    lastPlayedPitchRef.current = null;
    setGridCursor('crosshair');
  }, []);
  useLayoutEffect(cancelNoteDrag, [cancelNoteDrag, revision]);
  useEffect(() => () => releaseGesture.current(), []);
  return { dragRef, gridCursor, setGridCursor, dragPitch, setDragPitch,
    lastPlayedPitchRef, releaseGesture, cancelNoteDrag };
}
