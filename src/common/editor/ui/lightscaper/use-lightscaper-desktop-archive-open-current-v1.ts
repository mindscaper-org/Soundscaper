/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { DesktopLightscaperArchiveOpenBridgeCurrentV1, DesktopLightscaperArchiveOpenDescriptorCurrentV1 } from '../../desktop-lightscaper-archive-open-contract-current-v1.ts';
import { LightscaperDesktopArchiveOpenCurrentV1, type LightscaperDesktopArchiveFileCurrentV1 } from '../../controller/composition/lightscaper-desktop-archive-open-current-v1.ts';
import { loadDesktopPhotoArchiveFileCurrentV1 } from '../../../../lightscaper/desktop-photo-archive-loader-current-v1.ts';

export interface LightscaperDesktopArchiveOpenHookOptionsCurrentV1 {
	readonly canPresent: () => boolean;
	readonly onPresent: () => void;
	readonly retireRestore: () => Promise<void>;
	readonly reportError: (error: unknown) => void;
	/** Tests supply a real File with explicit deletion ownership. */
	readonly load?: (descriptor: Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1>, signal: AbortSignal) => Promise<Readonly<LightscaperDesktopArchiveFileCurrentV1>>;
}
interface Scope { readonly lightscaperDesktop?: { readonly v1?: DesktopLightscaperArchiveOpenBridgeCurrentV1 } }

/** The existing dialog owns confirmation. This hook only admits a staged source
 * and keeps it alive across dialog hiding, Session epochs and native readers. */
export function useLightscaperDesktopArchiveOpenCurrentV1(options: LightscaperDesktopArchiveOpenHookOptionsCurrentV1) {
	const latest = useRef(options); latest.current = options;
	const owner = useRef<LightscaperDesktopArchiveOpenCurrentV1 | null>(null), mounted = useRef(false);
	const drain = useRef<Promise<void> | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const [, refreshPending] = useReducer((value: number) => value + 1, 0);
	useEffect(() => {
		mounted.current = true;
		const bridge = (window as Window & Scope).lightscaperDesktop?.v1;
		if (!bridge || typeof bridge.takeArchive !== 'function' || typeof bridge.finishArchive !== 'function'
			|| typeof bridge.onArchiveAvailable !== 'function') return () => { mounted.current = false; };
		const current = new LightscaperDesktopArchiveOpenCurrentV1({
			bridge,
			load: async (descriptor, signal) => {
				const supplied = latest.current.load;
				if (supplied) return await supplied(descriptor, signal);
				return await loadDesktopPhotoArchiveFileCurrentV1(descriptor, { signal, finishArchive: request => bridge.finishArchive(request) });
			},
			canPresent: () => mounted.current && latest.current.canPresent(),
			onFile: next => { if (mounted.current && owner.current === current) setFile(next); },
			onPresent: () => { if (mounted.current && owner.current === current) latest.current.onPresent(); },
			retireRestore: () => latest.current.retireRestore(),
			reportError: error => { latest.current.reportError(error); },
			onPendingChange: () => { if (mounted.current && owner.current === current) refreshPending(); },
		});
		owner.current = current; current.mount();
		// Settings and other global dialogs can close without rerendering this
		// kernel. Observe their structural/role transitions as admission wakeups.
		const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => { current.tick(); }) : null;
		observer?.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'open'] });
		return () => {
			observer?.disconnect();
			mounted.current = false;
			if (owner.current === current) owner.current = null;
			const retiring = current.retireAndJoin();
			drain.current = join(drain.current, retiring);
			void drain.current.catch(error => { try { latest.current.reportError(error); } catch { /* Preserve the joined retirement failure. */ } });
		};
	}, []);
	useEffect(() => { owner.current?.tick(); });
	const dismiss = useCallback(() => owner.current?.dismiss() ?? Promise.resolve(), []);
	const retireAndJoin = useCallback(() => {
		const retiring = owner.current?.retireAndJoin();
		drain.current = join(drain.current, retiring);
		return drain.current;
	}, []);
	const withFileConsumer = useCallback(async <Result>(source: File, consume: (source: File) => Promise<Result>): Promise<Result> => {
		if (!mounted.current) throw new DOMException('Desktop archive admission is unmounted.', 'AbortError');
		const current = owner.current;
		return current ? await current.withFileConsumer(source, consume) : await consume(source);
	}, []);
	const isPending = useCallback(() => owner.current?.isPending() ?? false, []);
	return { file, dismiss, retireAndJoin, withFileConsumer, isPending };
}

async function join(...promises: readonly (Promise<void> | null | undefined)[]): Promise<void> {
	const results = await Promise.allSettled(promises.filter((value): value is Promise<void> => value !== null && value !== undefined));
	for (const result of results) if (result.status === 'rejected') throw result.reason;
}
