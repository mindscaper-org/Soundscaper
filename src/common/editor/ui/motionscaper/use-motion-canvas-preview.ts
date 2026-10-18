/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createMotionPreviewClient } from '../../controller/composition/motion-preview-client.ts';
import type { MotionPreviewClient } from '../../controller/composition/motion-preview-types.ts';
import { createMotionMediaProvider } from '../../motion-media-provider.ts';
import { compareRationals, divideRationals, type Rational } from '../../timeline-time.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import { loadMotionscaperAssetBytes, type MotionAssetReader } from '../../../../motionscaper/editor-render-resources.ts';
interface CanvasRequest { readonly project: MotionscaperProject; readonly compositionId: string; readonly frame: Rational }
function matchesBase(request: CanvasRequest, base: CanvasRequest): boolean {
	return request.project === base.project && request.compositionId === base.compositionId && compareRationals(request.frame, base.frame) === 0;
}
/** Only matching painted base pixels authorize a new edit; an ongoing draft gesture can continue. */
export function useMotionCanvasPreview(canvas: RefObject<HTMLCanvasElement | null>, request: CanvasRequest, store: MotionAssetReader, base: CanvasRequest): Readonly<{ error: string | null; ready: boolean }> {
	const session = useMemo(() => ({}), [canvas, store]);
	const [failure, setFailure] = useState<Readonly<{ session: object; message: string }> | null>(null);
	const [painted, setPainted] = useState<Readonly<{ session: object; request: CanvasRequest }> | null>(null);
	const submit = useRef<((request: CanvasRequest) => void) | null>(null); const latest = useRef({ request, session }); latest.current = { request, session };
	useEffect(() => {
		let disposed = false; let client: MotionPreviewClient | null = null; let pending: CanvasRequest | null = null; let active: CanvasRequest | null = null; let draining = false;
		const current = (next: CanvasRequest | null) => !disposed && latest.current.session === session && latest.current.request === next;
		const report = (error: unknown) => { if (!disposed && latest.current.session === session) { setPainted(null); setFailure({ session, message: error instanceof Error ? error.message : String(error) }); } };
		const loadAsset = (asset: Parameters<typeof loadMotionscaperAssetBytes>[0], signal?: AbortSignal) => loadMotionscaperAssetBytes(asset, store, signal);
		const provider = createMotionMediaProvider({ loadAsset });
		const drain = async () => {
			if (draining || !client) return; draining = true;
			try {
				while (pending && !disposed) {
					const next = pending; pending = null; active = next; setFailure(null);
					const composition = next.project.compositions.find(item => item.id === next.compositionId); if (!composition) continue;
					try {
						await client.setProject(next.project, loadAsset, provider.decodeFootage);
						if (!pending && current(next)) await client.seek({ compositionId: next.compositionId, time: divideRationals(next.frame, composition.frameRate) });
					} catch (error) { if (!pending && current(next)) report(error); }
				}
			} finally { draining = false; active = null; }
		};
		submit.current = next => { pending = next; client?.pause(); void drain(); };
		void (async () => {
			try {
				client = await createMotionPreviewClient({ onState: state => { if (current(active) && state.status === 'error') report(state.error); },
					onFrame: frame => {
						const next = active;
						if (!next || !current(next) || pending || !canvas.current) return; const context = canvas.current.getContext('2d');
						if (!context) throw new Error('Canvas preview is unavailable.');
						canvas.current.width = frame.width; canvas.current.height = frame.height;
						context.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
						canvas.current.dataset.motionRendered = String(frame.revision);
						setPainted({ session, request: next });
					} });
				if (disposed) { client.dispose(); return; } pending = latest.current.request; await drain();
			} catch (error) { report(error); }
		})();
		return () => { disposed = true; pending = null; submit.current = null; client?.dispose(); provider.dispose(); };
	}, [canvas, store, session]);
	useEffect(() => { submit.current?.(request); }, [request]);
	const error = failure?.session === session ? failure.message : null;
	return { error, ready: error === null && painted?.session === session && matchesBase(painted.request, base) };
}
