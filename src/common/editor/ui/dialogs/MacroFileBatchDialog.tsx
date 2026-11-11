/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { macroScriptIsRunnable, type MacroScriptRecord } from '../../macro-script-library.ts';
import { sanitizeSuggestedFileName } from '../../portable-save-file-name.ts';
import { effectMacroMissingEmbeddedNoiseProfile } from '../../effect-macro-readiness.ts';
import type { MacroFileBatchDefinition, MacroFileBatchFormat, MacroFileBatchRequest, MacroFileBatchRow } from '../../controller/effects/macro-file-batch-service.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import './MacroFileBatchDialog.css';

interface Input { readonly id: string; readonly name: string; readonly originalFile?: { readonly id: string } }
interface Target { readonly batchId: string; readonly index: number; readonly name: string }
interface Directory { readonly id: string; readonly name: string; readonly displayPath: string; readonly files: readonly string[] }
interface FileService {
	readonly isDesktop: boolean;
	chooseFiles(request: { purpose: string; multiple: boolean }): Promise<unknown[]>;
	chooseBatchSaveDirectory(names?: readonly string[]): unknown;
	planBatchSaveOutputs(batchId: string, names: readonly string[]): unknown;
	releaseBatchSaveDirectory(id: string): unknown;
	releaseRead(id: string): unknown;
	releaseOriginalFile(id: string): unknown;
}
interface Props {
	readonly fileService: FileService;
	readonly controller: { readonly actions: { readonly macros: {
		applyToFiles?: (request: MacroFileBatchRequest<Input, Target>) => Promise<readonly MacroFileBatchRow[]>;
	} } };
	readonly snapshot: { readonly macros?: {
		readonly library?: readonly { readonly id: string; readonly name: string; readonly effects: readonly Readonly<Record<string, unknown>>[] }[];
		readonly scripts?: readonly MacroScriptRecord[];
	} };
	readonly copy: Readonly<Record<string, string>>;
	readonly initialMacro?: MacroFileBatchDefinition | null;
	readonly onClose: () => void;
}

export default function MacroFileBatchDialog({ controller, fileService, snapshot, copy, initialMacro, onClose }: Props) {
	const choices = [
		...(initialMacro ? [{ id: 'current', macro: initialMacro, enabled: true }] : []),
		...(snapshot.macros?.library ?? []).map(macro => ({ id: `steps:${macro.id}`,
			macro: { kind: 'steps' as const, name: macro.name, effects: macro.effects }, enabled: macro.effects.length > 0 && !effectMacroMissingEmbeddedNoiseProfile(macro.effects) })),
		...(snapshot.macros?.scripts ?? []).map(script => ({ id: `script:${script.id}`,
			macro: { kind: 'script' as const, name: script.name, source: script.source }, enabled: macroScriptIsRunnable(script) })),
	];
	const [selected, setSelected] = useState(choices.find(choice => choice.enabled)?.id ?? '');
	const [format, setFormat] = useState<MacroFileBatchFormat>('wav');
	const [files, setFiles] = useState<readonly Input[]>([]), [rows, setRows] = useState<readonly MacroFileBatchRow[]>([]);
	const [directory, setDirectory] = useState<Directory | null>(null);
	const [busy, setBusy] = useState(false), [error, setError] = useState(''), [current, setCurrent] = useState<string | null>(null);
	const retained = useRef<readonly Input[]>([]), destination = useRef<Directory | null>(null);
	const operation = useRef<AbortController | null>(null), alive = useRef(true);
	const macro = choices.find(choice => choice.id === selected && choice.enabled)?.macro;
	const available = fileService.isDesktop && typeof controller.actions.macros.applyToFiles === 'function';
	const release = useCallback(async (inputs: readonly Input[]): Promise<void> => {
		await Promise.allSettled(inputs.flatMap(input => [Promise.resolve().then(() => fileService.releaseRead(input.id)),
			...(input.originalFile ? [Promise.resolve().then(() => fileService.releaseOriginalFile(input.originalFile!.id))] : [])]));
	}, [fileService]);
	const releaseDirectory = useCallback(async (folder: Directory | null): Promise<void> => {
		if (folder) await fileService.releaseBatchSaveDirectory(folder.id);
	}, [fileService]);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false; operation.current?.abort();
			void Promise.allSettled([release(retained.current), releaseDirectory(destination.current)]);
			retained.current = []; destination.current = null;
		};
	}, [release, releaseDirectory]);
	const perform = (task: (signal: AbortSignal) => Promise<void>): void => {
		if (!available || operation.current) return;
		const cancellation = new AbortController(); operation.current = cancellation; setBusy(true); setError('');
		void task(cancellation.signal)
			.catch((cause: unknown) => { if (alive.current && !cancellation.signal.aborted) setError(message(cause)); })
			.finally(() => { if (operation.current === cancellation) { operation.current = null; if (alive.current) { setBusy(false); setCurrent(null); } } });
	};
	const choose = (): void => perform(async signal => {
		const chosen = (await fileService.chooseFiles({ purpose: 'audio', multiple: true })).filter(isInput);
		let adopted = false;
		try {
			if (!chosen.length || signal.aborted || !alive.current) return;
			if (chosen.length > 100) throw new RangeError('Choose at most 100 audio files.');
			const previous = retained.current;
			retained.current = chosen; adopted = true; setFiles(chosen); setRows([]);
			await release(previous);
		} finally { if (!adopted) await release(chosen); }
	});
	const chooseDirectory = (): void => perform(async signal => {
		const chosen = directoryResult(await fileService.chooseBatchSaveDirectory());
		let adopted = false;
		try {
			if (!chosen || signal.aborted || !alive.current) return;
			const previous = destination.current;
			destination.current = chosen; adopted = true; setDirectory(chosen); setRows([]);
			await releaseDirectory(previous);
		} finally { if (!adopted) await releaseDirectory(chosen); }
	});
	const run = (): void => {
		const folder = destination.current;
		if (!macro || !retained.current.length || !folder) return;
		perform(async signal => {
			const inputs = retained.current.slice(); setRows([]);
			const names = inputs.map(input => `${sanitizeSuggestedFileName(input.name).replace(/\.[^.]+$/u, '').slice(0, 120)}-processed.${format}`);
			const planned = directoryResult(await fileService.planBatchSaveOutputs(folder.id, names));
			signal.throwIfAborted();
			if (!planned || planned.id !== folder.id || planned.files.length !== inputs.length) throw new Error('The output folder is unavailable.');
			const result = await controller.actions.macros.applyToFiles!({ macro, format, signal,
				items: inputs.map((input, index) => ({ input, target: { batchId: planned.id, index, name: planned.files[index]! } })),
				onProgress: (completed, _total, file) => { if (alive.current) { setRows(completed); setCurrent(file); } },
			});
			if (alive.current) setRows(result);
		});
	};
	const close = (): void => { operation.current?.abort(); onClose(); };
	const statuses = { completed: copy.macroBatchCompleted, failed: copy.macroBatchFailed, cancelled: copy.macroBatchCancelled, skipped: copy.macroBatchSkipped };
	return <AudioEditorDialogShell title={copy.macroApplyToFiles!} onClose={close} width={620}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={busy ? () => operation.current?.abort() : close}>{busy ? copy.cancel : copy.close}</Button>
			<Button variant="primary" disabled={!available || busy || !macro || !files.length || !directory} onClick={run}>{copy.runMacro}</Button>
		</>} />}>
		<div className="kw-audio-editor-dialog__form audio-editor-macro-batch" aria-busy={busy}>
			<p className="audio-editor-panel-hint">{available ? copy.macroBatchHint : copy.macroBatchDesktop}</p>
			<label className="kw-audio-editor-dialog__field"><span>{copy.macroBatchMacro}</span><select value={selected} disabled={busy} onChange={event => { setSelected(event.currentTarget.value); setRows([]); }}>
				{choices.map(choice => <option key={choice.id} value={choice.id} disabled={!choice.enabled}>{choice.macro.name}</option>)}
			</select></label>
			<label className="kw-audio-editor-dialog__field"><span>{copy.macroBatchFormat}</span><select value={format} disabled={busy} onChange={event => { setFormat(event.currentTarget.value as MacroFileBatchFormat); setRows([]); }}>
				<option value="wav">{copy.macroBatchWav}</option><option value="flac">{copy.macroBatchFlac}</option><option value="mp3">{copy.macroBatchMp3}</option>
			</select></label>
			<section>
				<div className="audio-editor-macro-batch__section-header"><strong>{copy.macroBatchInputFiles}</strong>
					<Button variant="secondary" onClick={choose} disabled={!available || busy}>{copy.macroBatchChooseFiles}</Button></div>
				{files.length > 0 && <div className="audio-editor-macro-batch__files" role="region" aria-label={copy.macroBatchInputFiles} tabIndex={0}>
					<table aria-label={copy.macroBatchInputFiles}>
						<thead><tr><th scope="col">{copy.macroBatchFile}</th><th scope="col">{copy.macroBatchStatus}</th></tr></thead>
						<tbody>{files.map((input, index) => <tr key={input.id}><td>{input.name}</td>
							<td>{rows[index] ? statuses[rows[index]!.status] : current && index === rows.length ? copy.macroBatchRunning : copy.macroBatchReady}
								{rows[index]?.message && <span className="audio-editor-macro-batch__detail">{rows[index]!.message}</span>}</td></tr>)}</tbody>
					</table>
				</div>}
			</section>
			<section>
				<div className="audio-editor-macro-batch__section-header"><strong>{copy.macroBatchOutputFolder}</strong>
					<Button variant="secondary" onClick={chooseDirectory} disabled={!available || busy}>{copy.macroBatchChooseFolder}</Button></div>
				<p className="audio-editor-macro-batch__output-path" aria-live="polite">{directory?.displayPath ?? copy.macroBatchNoOutputFolder}</p>
			</section>
			{current && <p role="status">{current}</p>}
			{!files.length && <p>{copy.macroBatchEmpty}</p>}
			{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
		</div>
	</AudioEditorDialogShell>;
}

function isInput(value: unknown): value is Input {
	return value !== null && typeof value === 'object' && typeof Reflect.get(value, 'id') === 'string' && typeof Reflect.get(value, 'name') === 'string';
}
function directoryResult(value: unknown): Directory | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || typeof Reflect.get(value, 'id') !== 'string' || typeof Reflect.get(value, 'name') !== 'string'
		|| typeof Reflect.get(value, 'displayPath') !== 'string' || !Array.isArray(Reflect.get(value, 'files'))
		|| !(Reflect.get(value, 'files') as unknown[]).every(file => typeof file === 'string')) throw new TypeError('Invalid output folder response.');
	return value as Directory;
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
