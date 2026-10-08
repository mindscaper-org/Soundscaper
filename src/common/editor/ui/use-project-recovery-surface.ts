/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';

/** Offer a damaged startup project once; the existing File menu can reopen recovery. */
export function useProjectRecoverySurface(
	productId: string,
	projectId: string | null | undefined,
	setActiveSurface: (surface: string) => void,
) {
	const offered = useRef<string | null>(null);
	useEffect(() => {
		if (productId !== 'soundscaper' || !projectId || offered.current === projectId) return;
		offered.current = projectId;
		setActiveSurface('project-recovery');
	}, [productId, projectId, setActiveSurface]);
}
