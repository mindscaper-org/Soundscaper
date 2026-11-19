/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState } from 'react';
import { registeredVideoTimingIndex } from '../../video-source-time.ts';

interface SourceMonitorVisual {
	readonly source: unknown;
	readonly available?: boolean;
	readonly mediaUrl?: string | null;
	readonly sourceMonitorBlob?: Blob;
}

export function useSourceMonitorMedia(visual: SourceMonitorVisual | null) {
	const url = visual?.available === false ? null : visual?.mediaUrl ?? null;
	const candidate = url ? visual?.sourceMonitorBlob : undefined;
	const blob = candidate && /^video\/(?:mp4|quicktime|x-m4v)(?:;|$)/iu.test(candidate.type) ? candidate : null;
	const timing = blob ? registeredVideoTimingIndex(visual?.source) : undefined;
	const request = useMemo(() => blob && timing ? { blob, timing } : null, [blob, timing]);
	const [prepared, setPrepared] = useState<Readonly<{ request: typeof request; url: string | null }> | null>(null);
	useEffect(() => {
		if (!request) return;
		const abort = new AbortController();
		let objectUrl: string | null = null;
		async function prepare(current: NonNullable<typeof request>) {
			try {
				const { prepareSourceMonitorFragmentView } = await import('../../video-source-monitor-fragment-view.ts');
				abort.signal.throwIfAborted();
				const view = await prepareSourceMonitorFragmentView(current.blob, current.timing, abort.signal);
				if (!abort.signal.aborted && view) objectUrl = URL.createObjectURL(view);
			} catch { /* Retain the original browser playback path for other ISO profiles. */ }
			if (!abort.signal.aborted) setPrepared({ request: current, url: objectUrl });
		}
		void prepare(request);
		return () => {
			abort.abort();
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [request]);
	const pending = request !== null && prepared?.request !== request;
	return { mediaUrl: pending ? null : prepared?.request === request ? prepared.url ?? url : url, pending };
}
