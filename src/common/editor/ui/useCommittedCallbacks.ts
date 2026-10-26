/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useRef, useState } from 'react';

/** Stable row actions read the latest committed owner without capturing speculative renders. */
export function useCommittedCallbacks<Callbacks extends Record<string, (...args: never[]) => unknown>>(callbacks: Callbacks): Callbacks {
	const committed = useRef(callbacks);
	useLayoutEffect(() => { committed.current = callbacks; }, [callbacks]);
	const [stable] = useState(() => Object.fromEntries(Object.keys(callbacks).map(key => [key,
		(...args: unknown[]): unknown => Reflect.apply(committed.current[key]!, undefined, args),
	])) as unknown as Callbacks);
	return stable;
}
