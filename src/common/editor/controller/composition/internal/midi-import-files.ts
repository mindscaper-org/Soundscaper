/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiService } from '../../track-audio/midi-service-types.ts';
import { raceAbortableRead } from '../../../../foundation/abort-race.ts';
import { isImportFileName } from '../../../import-file-extensions.ts';
import { EditorProjectChangedError } from '../../shared/lifecycle.ts';

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

type ImportProject = Readonly<{ id: string; sampleRate: number }>;

interface MidiImportRuntime {
	getProject(): ImportProject | null;
	importFiles(files: readonly MidiImportFile[], options: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
}

export function createMidiImportFiles(scope: MidiImportRuntime,
	service: () => Promise<Readonly<Pick<MidiService, 'importDocument'>>>) {
	const requests = new Set<{ project: ImportProject | null }>();
	function assertCurrent(context: { project: ImportProject | null }): void {
		if (scope.getProject() !== context.project) throw new EditorProjectChangedError();
	}
	function followSelection(before: ImportProject, after: ImportProject): void {
		for (const context of requests) if (context.project === before) context.project = after;
	}
	async function importFiles(fileList: readonly MidiImportFile[] | FileList | null | undefined, options: MidiImportOptions = {}): Promise<unknown> {
		const context = { project: scope.getProject() };
		requests.add(context);
		try {
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
			assertCurrent(context);
			if (!kinds.some(kind => kind !== 'other')) return scope.importFiles(files, options);
			let result: unknown;
			let placedFiles = 0;
			const retainsTrackPlacement = options.destination === 'timeline' && typeof options.trackId === 'string';
			for (let index = 0; index < files.length; index += 1) {
				options.signal?.throwIfAborted();
				assertCurrent(context);
				const file = files[index]!;
				if (kinds[index] === 'other') {
					result = await scope.importFiles([file], retainsTrackPlacement ? { ...options, fileIndexOffset: placedFiles } : options);
					if (result && typeof result === 'object' && 'cancelled' in result && result.cancelled === true) return result;
					if (result && typeof result === 'object' && 'importedFileCount' in result
						&& typeof result.importedFileCount === 'number' && Number.isSafeInteger(result.importedFileCount) && result.importedFileCount > 0) placedFiles += result.importedFileCount;
					context.project = scope.getProject(); continue;
				}
				const { MIDI_FILE_MAX_BYTES } = await import('../../../midi-file-types.ts');
				if (file.size !== undefined && file.size > MIDI_FILE_MAX_BYTES) throw new RangeError('MIDI files cannot exceed 16 MiB.');
				const sampleRate = context.project?.sampleRate ?? 48_000;
				const parse = kinds[index] === 'midi'
					? async () => {
						const { parseMidiFile } = await import('../../../midi-file.ts');
						const bytes = await readMidiBytes(file, options.signal);
						assertCurrent(context);
						return parseMidiFile(bytes, { sampleRate });
					}
					: async () => {
						const { parseAllegroFile } = await import('../../../allegro-file.ts');
						const text = await readAllegroText(file, options.signal);
						assertCurrent(context);
						return parseAllegroFile(text, { sampleRate });
					};
				const document = await parse();
				assertCurrent(context);
				const loaded = await raceAbortableRead(service, options.signal);
				assertCurrent(context);
				result = await loaded.importDocument(document, options);
				context.project = scope.getProject();
			}
			return result;
		} finally { requests.delete(context); }
	}
	return Object.freeze({ importFiles, followSelection });
}

function readMidiBytes(file: MidiImportFile, signal?: AbortSignal): Promise<ArrayBuffer> {
	return raceAbortableRead(() => {
		if (typeof file.arrayBuffer !== 'function') throw new TypeError('MIDI import requires readable file bytes.');
		return file.arrayBuffer();
	}, signal);
}

function readAllegroText(file: MidiImportFile, signal?: AbortSignal): Promise<string> {
	return raceAbortableRead(async () => {
		if (typeof file.arrayBuffer === 'function') {
			const bytes = await file.arrayBuffer();
			const { decodeMidiFileText } = await import('../../../midi-file-text.ts');
			return decodeMidiFileText(new Uint8Array(bytes));
		}
		if (typeof file.text === 'function') return file.text();
		throw new TypeError('Allegro import requires readable text or file bytes.');
	}, signal);
}
