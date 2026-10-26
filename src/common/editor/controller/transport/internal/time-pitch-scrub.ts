/* SPDX-License-Identifier: AGPL-3.0-only */

interface ScrubEngine {
	getPositionFrames(): number;
	getAudioContext?(): Promise<unknown>;
	scrub?(frame: number): Promise<number>;
	seek(frame: number): number;
	endScrub?(): unknown;
}

interface Dependencies<Project> {
	readonly engine: ScrubEngine;
	getProject(): Project | null;
	blocked(): boolean;
	assertSources(): void;
	normalizeFrame(frame: number): number;
	prepare(project: Project, abort: AbortController): Promise<unknown>;
}

interface ScrubRequest<Project> {
	readonly project: Project;
	readonly abort: AbortController;
	frame: number;
	ready: boolean;
	pending?: Promise<number>;
}

/** Prepare once per pointer gesture; moves during preparation replace its pending grain. */
export function createTimePitchScrub<Project>(dependencies: Dependencies<Project>) {
	let active: ScrubRequest<Project> | null = null;
	const engine = dependencies.engine;
	const scrub = engine.scrub?.bind(engine);
	function cancel(): void {
		const previous = active;
		active = null;
		previous?.abort.abort();
	}
	function current(request: ScrubRequest<Project>): boolean {
		return active === request && !request.abort.signal.aborted && !dependencies.blocked()
			&& dependencies.getProject() === request.project;
	}
	function request(frame: number): number | Promise<number> {
		if (dependencies.blocked()) return engine.getPositionFrames();
		dependencies.assertSources();
		const next = dependencies.normalizeFrame(frame);
		if (!scrub) return engine.seek(next);
		const project = dependencies.getProject();
		if (project === null) throw new Error('Scrubbing requires an open project.');
		if (active && active.project === project && !active.abort.signal.aborted) {
			active.frame = next;
			return active.ready ? scrub(next) : active.pending!;
		}
		cancel();
		const owned: ScrubRequest<Project> = { project, frame: next, abort: new AbortController(), ready: false };
		active = owned;
		owned.pending = prepare(owned);
		return owned.pending;
	}
	async function prepare(owned: ScrubRequest<Project>): Promise<number> {
		try {
			// Begin context activation in the initiating pointer event, before the cache await.
			await Promise.all([engine.getAudioContext?.(), Promise.resolve().then(() => current(owned)
				? dependencies.prepare(owned.project, owned.abort) : undefined)]);
			if (!current(owned)) {
				if (active === owned) cancel();
				return engine.getPositionFrames();
			}
			owned.ready = true;
			return await scrub!(owned.frame);
		} catch (error) {
			const report = current(owned);
			if (active === owned) cancel();
			if (report) throw error;
			return engine.getPositionFrames();
		}
	}
	return Object.freeze({ request, cancel, end() { cancel(); return engine.endScrub?.(); } });
}
