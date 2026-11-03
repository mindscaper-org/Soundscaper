/* SPDX-License-Identifier: AGPL-3.0-only */
import { disposeGraph } from './dispose-project-graph.ts';
import type { ProjectGraph } from './project-graph.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';

const candidates = new WeakMap<EngineRuntimeHost, () => void>();
interface RetiredGraph { timer: ReturnType<typeof setTimeout>; dispose(): void }
const retired = new WeakMap<EngineRuntimeHost, Map<ProjectGraph, RetiredGraph>>();

export function cancelPendingProjectRefresh(engine: EngineRuntimeHost): void {
	const cancel = candidates.get(engine);
	candidates.delete(engine);
	cancel?.();
}

export function ownProjectRefresh(engine: EngineRuntimeHost, cancel: () => void): () => void {
	cancelPendingProjectRefresh(engine);
	candidates.set(engine, cancel);
	return () => { if (candidates.get(engine) === cancel) candidates.delete(engine); };
}

/** Transport changes retire both an uncommitted candidate and graphs draining to a swap. */
export function cancelProjectRefresh(engine: EngineRuntimeHost): void {
	cancelPendingProjectRefresh(engine);
	const graphs = retired.get(engine);
	retired.delete(engine);
	for (const { timer, dispose } of graphs?.values() ?? []) {
		clearTimeout(timer);
		dispose();
	}
}

export function retireProjectGraph(engine: EngineRuntimeHost, graph: ProjectGraph, atTime: number, retireResource?: () => void): void {
	const graphs = retired.get(engine) ?? new Map<ProjectGraph, RetiredGraph>();
	retired.set(engine, graphs);
	const dispose = (): void => { disposeGraph(graph, true); retireResource?.(); };
	const schedule = (): ReturnType<typeof setTimeout> => {
		const remaining = atTime - (engine.context?.currentTime ?? atTime);
		const timer = setTimeout(() => {
			const entry = graphs.get(graph);
			if (!entry) return;
			if ((engine.context?.currentTime ?? atTime) < atTime) { entry.timer = schedule(); return; }
			graphs.delete(graph); dispose();
		}, Math.max(10, remaining * 1000 + 10));
		(timer as unknown as { unref?(): void }).unref?.();
		return timer;
	};
	graphs.set(graph, { timer: schedule(), dispose });
}
