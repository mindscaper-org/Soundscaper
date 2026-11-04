/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';

/** Offer each damaged-project open once; the existing File menu can reopen recovery. */
export function useProjectRecoverySurface(
	productId: string,
	projectId: string | null | undefined,
	setActiveSurface: (surface: string) => void,
	requestId = 0,
) {
	const offered = useRef<string | null>(null);
	useEffect(() => {
		const key = `${projectId ?? ''}:${requestId}`;
		if (productId !== 'soundscaper' || !projectId || offered.current === key) return;
		offered.current = key;
		setActiveSurface('project-recovery');
	}, [productId, projectId, requestId, setActiveSurface]);
}
