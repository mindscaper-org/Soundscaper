/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LocalAssistanceBridge, LocalAssistanceModel } from '../assistance/local-assistance-bridge.ts';
import type { VideoKeyingWorkflowOptions } from '../controller/assistance/local-assistance-video-keying.ts';

export interface FramescaperCorridorKeyRequest extends VideoKeyingWorkflowOptions {
	readonly bridge: LocalAssistanceBridge;
	readonly preflightModel: (signal: AbortSignal) => Promise<LocalAssistanceModel>;
}
export interface FramescaperCorridorKeyRuntime {
	run(request: FramescaperCorridorKeyRequest): Promise<Readonly<{ sourceId: string }>>;
}
const RUNTIMES = new WeakMap<object, FramescaperCorridorKeyRuntime>();
export function bindFramescaperCorridorKeyRuntime(owner: object, runtime: FramescaperCorridorKeyRuntime): void {
	RUNTIMES.set(owner, runtime);
}
export function framescaperCorridorKeyRuntimeFor(owner: unknown): FramescaperCorridorKeyRuntime | null {
	return owner && typeof owner === 'object' ? RUNTIMES.get(owner) ?? null : null;
}
