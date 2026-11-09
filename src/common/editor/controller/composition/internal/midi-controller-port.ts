/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ProjectChangedOptions } from '../../document/project-mutation-service.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { MidiProject, MidiTransferSelection, MidiTransferSnapshot } from '../../track-audio/midi-service-types.ts';
import { raceAbortableRead } from '../../../../foundation/abort-race.ts';
import type { AnalysisActions } from '../../analysis/analysis-composition.ts';

export interface MidiControllerBinding {
	followSelection(before: MidiProject, after: MidiProject): void;
	settled(expectedProject?: MidiProject, readiness?: PromiseLike<unknown>): Promise<void>;
	hasPendingEdits(): boolean;
	commitTransfer(command: AudioEditorCommand, preview: (command: AudioEditorCommand) => MidiTransferSnapshot,
		selection?: MidiTransferSelection, options?: ProjectChangedOptions): unknown;
}

/** One controller owns one lazy MIDI queue shared by gestures, saves and transfers. */
export function createMidiControllerPort() {
	let owner: MidiControllerBinding | null = null;
	return Object.freeze({
		bind(value: MidiControllerBinding): void {
			if (owner && owner !== value) throw new Error('The MIDI controller owner is already bound.');
			owner = value;
		},
		settled: async (expectedProject?: MidiProject, readiness?: PromiseLike<unknown>): Promise<void> => { await owner?.settled(expectedProject, readiness); },
		followSelection: (before: MidiProject, after: MidiProject): void => { owner?.followSelection(before, after); },
		hasPendingEdits: (): boolean => owner?.hasPendingEdits() ?? false,
		commitTransfer(command: AudioEditorCommand, preview: (command: AudioEditorCommand) => MidiTransferSnapshot,
			selection?: MidiTransferSelection, options?: ProjectChangedOptions): unknown {
			if (!owner) throw new Error('The MIDI controller is not ready.');
			return owner.commitTransfer(command, preview, selection, options);
		},
	});
}
export type MidiControllerPort = ReturnType<typeof createMidiControllerPort>;

interface MidiPendingSnapshotPorts<Project extends object> {
	hasPendingEdits(): boolean;
	settled(expectedProject: Project, readiness?: PromiseLike<unknown>): Promise<void>;
	prepareAudio?(project: Project, signal: AbortSignal): Promise<unknown>;
	getProject(): Project | null;
	captureTarget(): string;
	active(): boolean;
}

/** Follow owned MIDI publications without retargeting or cancelling the preceding edit. */
export function createMidiPendingSnapshotAdmission<Project extends object>(ports: MidiPendingSnapshotPorts<Project>) {
	let queued: AbortController | null = null;
	const retired = () => new DOMException('The pending audio operation was retired.', 'AbortError');
	function beforeRead(): (() => Promise<() => void>) | undefined {
		if (!ports.hasPendingEdits()) return undefined;
		const project = ports.getProject(), target = ports.captureTarget(), abort = queued ??= new AbortController();
		const current = () => !abort.signal.aborted && ports.active() && ports.captureTarget() === target;
		return async () => {
			if (!project || !current()) throw retired();
			try {
				await raceAbortableRead(() => ports.settled(project), abort.signal, 'immediate');
				if (!current()) throw retired();
				if (ports.prepareAudio) for (;;) {
					const snapshot = ports.getProject(); if (!snapshot) throw retired();
					const readiness = ports.prepareAudio(snapshot, abort.signal);
					// Keep the owning MIDI/selection lineage alive during activation.
					await raceAbortableRead(() => Promise.all([ports.settled(snapshot, readiness), readiness]), abort.signal, 'immediate');
					if (!current()) throw retired();
					if (ports.getProject() === snapshot) break;
					// Another owned publication needs its own declared render inputs.
				}
			}
			catch (error) { if (!current()) throw retired(); throw error; }
			if (!current()) throw retired();
			const prepared = ports.getProject();
			return () => { if (!current() || ports.getProject() !== prepared) throw retired(); };
		};
	}
	return Object.freeze({
		beforeRead,
		run<Args extends unknown[], Result>(operation: (...args: Args) => Result) {
			return (...args: Args): Result | Promise<Awaited<Result>> => {
				const ready = beforeRead();
				return ready ? (async (): Promise<Awaited<Result>> => {
					const assertPrepared = await ready(); assertPrepared(); return await operation(...args);
				})() : operation(...args);
			};
		},
		cancel(): void { queued?.abort(retired()); queued = null; },
	});
}

type MidiAnalysisRestriction = <Args extends unknown[], Result>(operation: (...args: Args) => Result) => (...args: Args) => Result;

/** Analysis must capture and cache PCM only after the preceding requested edit. */
export function createMidiPendingAnalysisActions<Project extends object>(
	service: AnalysisActions,
	ports: MidiPendingSnapshotPorts<Project>,
	restrict: MidiAnalysisRestriction,
) {
	const admission = createMidiPendingSnapshotAdmission(ports);
	const prepare = <Args extends unknown[], Result>(operation: (...args: Args) => Result) => restrict((...args: Args) => {
		admission.cancel();
		return admission.run(operation)(...args);
	});
	return Object.freeze({
		run: prepare(service.run), plotSpectrum: prepare(service.plotSpectrum), findClipping: prepare(service.findClipping),
		contrast: prepare(service.captureContrast), repeatLast: prepare(service.repeatLast), measureLoudness: prepare(service.measureLoudness),
		findRepeatedSound: prepare(service.findRepeatedSound),
	});
}
