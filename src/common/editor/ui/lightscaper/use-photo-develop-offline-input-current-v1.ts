/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getDesktopPhotoDevelopAvailabilityCurrentV1 as sourceOf } from '../../../../lightscaper/desktop-photo-develop-availability-registry-current-v1.ts';
import type { PhotoDevelopInputQualityCurrentV1 } from '../../photo-develop-input-quality-current-v1.ts';
const CHECK = AbortSignal.prototype.throwIfAborted;
/** A fresh owner/photo/revision blocks presentation immediately. The actual
 * native source owns admission/retirement; no UI action queues behind itself. */
export function usePhotoDevelopOfflineInputCurrentV1(current: boolean, execute: unknown, owner: object, photoId: string, revision: number | undefined,
	register: (retire: () => Promise<void>) => () => void) {
	const source = current ? sourceOf(execute) : null;
	const key = useMemo(() => ({ source, owner, photoId, revision }), [source, owner, photoId, revision]);
	const [state, setState] = useState<Readonly<{ key: typeof key; quality: PhotoDevelopInputQualityCurrentV1; pending: boolean; failed: boolean }>>(() => ({ key, quality: 'original', pending: source !== null && revision !== undefined, failed: false }));
	const predecessor = useRef<Promise<void>>(Promise.resolve());
	const selected = state.key === key ? state : { key, quality: 'original' as const, pending: source !== null && revision !== undefined, failed: false };
	useLayoutEffect(() => {
		if (!source || revision === undefined) return;
		const stop = new AbortController(); let live = true, closing: Promise<void> | undefined;
		const work = predecessor.current.then(async () => {
			Reflect.apply(CHECK, stop.signal, []);
			return await source.read({ photoId, expectedRevision: revision }, { signal: stop.signal });
		});
		const retire = (): Promise<void> => {
			if (closing) return closing;
			let resolve!: () => void; closing = new Promise<void>(done => { resolve = done; }); stop.abort();
			void Promise.allSettled([work]).then(() => { resolve(); }); return closing;
		};
		const unregister = register(retire);
		void work.then(result => { if (live) setState({ key, quality: result.quality, pending: false, failed: false }); }, () => { if (live) setState({ key, quality: 'original', pending: false, failed: true }); });
		return () => { live = false; const joined = retire(); predecessor.current = joined; void joined.then(unregister); };
	}, [key, source, photoId, revision, register]);
	return selected;
}
