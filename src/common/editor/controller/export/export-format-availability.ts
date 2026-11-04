/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selection-owned codec admission and explicit FFmpeg installation. */
export interface ExportFormatProbe {
	readonly available: boolean;
	readonly requiresFfmpeg?: boolean;
	readonly reasonCode?: string | null;
	readonly missingCapabilities?: readonly string[];
	readonly cause?: string;
}

export interface ExportFormatProblem {
	readonly kind: 'missing-ffmpeg' | 'unavailable';
	readonly canInstall: boolean;
	readonly failure: ExportFormatProbe;
	readonly ffmpegState: string | null;
	readonly detail: string;
}

export interface ExportFormatAvailabilitySnapshot {
	readonly owner: object | null;
	readonly checking: boolean;
	readonly installing: boolean;
	readonly available: boolean;
	readonly problem: ExportFormatProblem | null;
}

interface Options {
	readonly readFfmpegStatus?: () => unknown | Promise<unknown>;
	readonly installFfmpeg?: () => unknown | Promise<unknown>;
}

const EMPTY: ExportFormatAvailabilitySnapshot = Object.freeze({
	owner: null, checking: false, installing: false, available: false, problem: null,
});

export function createExportFormatAvailability(options: Options) {
	let snapshot = EMPTY;
	let generation = 0;
	let selection: { owner: object; probe: () => Promise<ExportFormatProbe> } | null = null;
	const listeners = new Set<() => void>();
	const publish = (value: ExportFormatAvailabilitySnapshot) => {
		snapshot = Object.freeze(value);
		for (const listener of listeners) listener();
	};
	async function check(owner: object, probe: () => Promise<ExportFormatProbe>): Promise<void> {
		const epoch = ++generation;
		selection = { owner, probe };
		publish({ ...EMPTY, owner, checking: true });
		let failure: ExportFormatProbe;
		try { failure = await probe(); }
		catch (error) { failure = { available: false, reasonCode: 'probe-failed', cause: errorText(error) }; }
		if (epoch !== generation) return;
		if (failure.available) {
			publish({ ...EMPTY, owner, available: true });
			return;
		}
		let status: Record<string, unknown> = {};
		if (failure.requiresFfmpeg) {
			try { status = record(await options.readFfmpegStatus?.()); }
			catch (error) { failure = { ...failure, cause: errorText(error) }; }
		}
		if (epoch !== generation) return;
		const missing = failure.requiresFfmpeg && failure.reasonCode !== 'probe-failed' && !status.location
			&& (status.state === 'unconfigured' || status.state === 'unavailable');
		publish({ ...EMPTY, owner, problem: Object.freeze({
			kind: missing ? 'missing-ffmpeg' : 'unavailable',
			canInstall: Boolean(missing && status.canInstall === true && options.installFfmpeg),
			failure,
			ffmpegState: typeof status.state === 'string' ? status.state : null,
			detail: typeof status.detail === 'string' ? status.detail.slice(0, 2_048) : '',
		}) });
	}
	async function install(): Promise<void> {
		const problem = snapshot.problem;
		const chosen = selection;
		if (!problem?.canInstall || snapshot.installing || !chosen || !options.installFfmpeg) return;
		const epoch = generation;
		publish({ ...snapshot, installing: true });
		try {
			const result = record(await options.installFfmpeg());
			if (epoch !== generation) return;
			if (result.state === 'ready') {
				await check(chosen.owner, chosen.probe);
				return;
			}
			publish({ ...snapshot, installing: false, problem: {
				...problem, failure: { ...problem.failure, reasonCode: 'install-failed',
					cause: typeof result.detail === 'string' ? result.detail.slice(0, 2_048) : '' },
			} });
		} catch (error) {
			if (epoch !== generation) return;
			publish({ ...snapshot, installing: false, problem: {
				...problem, failure: { ...problem.failure, reasonCode: 'install-failed', cause: errorText(error) },
			} });
		}
	}
	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		check,
		install,
		async retry(): Promise<void> { if (selection) await check(selection.owner, selection.probe); },
		dismiss() { publish({ ...snapshot, problem: null }); },
		reset() { generation += 1; selection = null; publish(EMPTY); },
		dispose() { generation += 1; selection = null; listeners.clear(); snapshot = EMPTY; },
	};
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message.slice(0, 2_048) : String(error).slice(0, 2_048);
}
