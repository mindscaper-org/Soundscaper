/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

interface PendingRecovery {
	readonly recoveryToken: string;
}

interface SurfaceRequest {
	readonly activeSurface: string | null;
	readonly requestId: number;
}

/** Auto-offer each exact recovery authority once while retaining menu reopen. */
export function useTakeCycleRecoverySurface(
	productId: string,
	pending: PendingRecovery | null | undefined,
) {
	const [request, setRequest] = useState<SurfaceRequest>({ activeSurface: null, requestId: 0 });
	const setActiveSurface = useCallback<Dispatch<SetStateAction<string | null>>>((update) => {
		setRequest(previous => {
			const activeSurface = typeof update === 'function' ? update(previous.activeSurface) : update;
			const requestId = previous.requestId + (typeof update === 'string' ? 1 : 0);
			return activeSurface === previous.activeSurface && requestId === previous.requestId
				? previous : { activeSurface, requestId };
		});
	}, []);
	const offeredToken = useRef<string | null>(null);
	useEffect(() => {
		if (productId !== 'soundscaper' || !pending) return;
		if (offeredToken.current === pending.recoveryToken) return;
		offeredToken.current = pending.recoveryToken;
		setActiveSurface('take-cycle-recovery');
	}, [pending, productId, setActiveSurface]);
	return [request.activeSurface, setActiveSurface, request.requestId] as const;
}
