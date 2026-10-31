/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiService } from '../../track-audio/midi-service-types.ts';

interface MidiImportOptions extends Readonly<Record<string, unknown>> {
	readonly timelineStartFrame?: number;
	readonly signal?: AbortSignal;
}

interface MidiImportRuntime {
	getProject(): Readonly<{ id: string; sampleRate: number }> | null;
	importFiles(files: readonly Blob[], options: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
}

export function createMidiImportFiles(scope: MidiImportRuntime,
	service: () => Promise<Readonly<Pick<MidiService, 'importDocument'>>>) {
	return async (fileList: readonly (Blob & { readonly name?: string })[] | FileList, options: MidiImportOptions = {}): Promise<unknown> => {
		let project = scope.getProject();
		const files = [...fileList];
		const kinds = await Promise.all(files.map(async file => {
			options.signal?.throwIfAborted();
			if (/\.gro$/iu.test(file.name ?? '')) return 'allegro';
			const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
			return /\.midi?$/iu.test(file.name ?? '') || String.fromCharCode(...header) === 'MThd' ? 'midi' : 'other';
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
			if (file.size > MIDI_FILE_MAX_BYTES) throw new RangeError('MIDI files cannot exceed 16 MiB.');
			const sampleRate = project?.sampleRate ?? 48_000;
			const document = kinds[index] === 'midi'
				? (await import('../../../midi-file.ts')).parseMidiFile(await file.arrayBuffer(), { sampleRate })
				: (await import('../../../allegro-file.ts')).parseAllegroFile(await file.text(), { sampleRate });
			if (scope.getProject() !== project) throw new Error('The project changed during MIDI import.');
			result = await (await service()).importDocument(document, options);
			project = scope.getProject();
		}
		return result;
	};
}
