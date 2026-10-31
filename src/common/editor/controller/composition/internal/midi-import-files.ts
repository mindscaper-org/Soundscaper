/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiService } from '../../track-audio/midi-service-types.ts';
import { raceAbortableRead } from '../../../../foundation/abort-race.ts';
import { isImportFileName } from '../../../import-file-extensions.ts';

interface MidiImportOptions extends Readonly<Record<string, unknown>> {
	readonly timelineStartFrame?: number;
	readonly signal?: AbortSignal;
}

/** Ordinary import ports need not be browser Blobs or support bounded reads. */
interface MidiImportFile {
	readonly name?: string;
	readonly type?: string;
	readonly size?: number;
	arrayBuffer?(): Promise<ArrayBuffer>;
	text?(): Promise<string>;
	slice?(start: number, end: number): Readonly<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

interface MidiImportRuntime {
	getProject(): Readonly<{ id: string; sampleRate: number }> | null;
	importFiles(files: readonly MidiImportFile[], options: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
}

export function createMidiImportFiles(scope: MidiImportRuntime,
	service: () => Promise<Readonly<Pick<MidiService, 'importDocument'>>>) {
	return async (fileList: readonly MidiImportFile[] | FileList | null | undefined, options: MidiImportOptions = {}): Promise<unknown> => {
		let project = scope.getProject();
		const files = [...(fileList ?? [])];
		const kinds = await Promise.all(files.map(async file => {
			options.signal?.throwIfAborted();
			if (/\.gro$/iu.test(file.name ?? '')) return 'allegro';
			if (/\.midi?$/iu.test(file.name ?? '')) return 'midi';
			// Preserve existing media admission, progress and native-read cancellation.
			if (isImportFileName(file.name) || typeof file.slice !== 'function') return 'other';
			const part = file.slice(0, 4);
			const header = new Uint8Array(await raceAbortableRead(() => part.arrayBuffer(), options.signal));
			return String.fromCharCode(...header) === 'MThd' ? 'midi' : 'other';
		}));
		if (scope.getProject() !== project) throw new Error('The project changed during MIDI import.');
		if (!kinds.some(kind => kind !== 'other')) return scope.importFiles(files, options);
		let result: unknown;
		for (let index = 0; index < files.length; index += 1) {
			options.signal?.throwIfAborted();
			if (scope.getProject() !== project) throw new Error('The project changed during MIDI import.');
			const file = files[index]!;
			if (kinds[index] === 'other') { result = await scope.importFiles([file], options); project = scope.getProject(); continue; }
			const { MIDI_FILE_MAX_BYTES } = await import('../../../midi-file-types.ts');
			if (file.size !== undefined && file.size > MIDI_FILE_MAX_BYTES) throw new RangeError('MIDI files cannot exceed 16 MiB.');
			const sampleRate = project?.sampleRate ?? 48_000;
			const document = kinds[index] === 'midi'
				? (await import('../../../midi-file.ts')).parseMidiFile(await readMidiBytes(file, options.signal), { sampleRate })
				: (await import('../../../allegro-file.ts')).parseAllegroFile(await readAllegroText(file, options.signal), { sampleRate });
			if (scope.getProject() !== project) throw new Error('The project changed during MIDI import.');
			const loaded = await raceAbortableRead(service, options.signal);
			if (scope.getProject() !== project) throw new Error('The project changed during MIDI import.');
			result = await loaded.importDocument(document, options);
			project = scope.getProject();
		}
		return result;
	};
}

function readMidiBytes(file: MidiImportFile, signal?: AbortSignal): Promise<ArrayBuffer> {
	return raceAbortableRead(() => {
		if (typeof file.arrayBuffer !== 'function') throw new TypeError('MIDI import requires readable file bytes.');
		return file.arrayBuffer();
	}, signal);
}

function readAllegroText(file: MidiImportFile, signal?: AbortSignal): Promise<string> {
	return raceAbortableRead(async () => {
		if (typeof file.text === 'function') return file.text();
		if (typeof file.arrayBuffer === 'function') return new TextDecoder().decode(await file.arrayBuffer());
		throw new TypeError('Allegro import requires readable text or file bytes.');
	}, signal);
}
