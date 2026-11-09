/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { macroScriptIsRunnable, type MacroScriptRecord } from '../../macro-script-library.ts';
import { sanitizeSuggestedFileName } from '../../portable-save-file-name.ts';
import { effectMacroMissingEmbeddedNoiseProfile } from '../../effect-macro-readiness.ts';
import type { MacroFileBatchDefinition, MacroFileBatchFormat, MacroFileBatchRequest, MacroFileBatchRow } from '../../controller/effects/macro-file-batch-service.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface Input { readonly id: string; readonly name: string; readonly originalFile?: { readonly id: string } }
interface Target { readonly batchId: string; readonly index: number; readonly name: string }
interface Directory { readonly id: string; readonly name: string; readonly files: readonly string[] }
interface FileService {
	readonly isDesktop: boolean;
	chooseFiles(request: { purpose: string; multiple: boolean }): Promise<unknown[]>;
	chooseBatchSaveDirectory(names: readonly string[]): unknown;
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
	const [busy, setBusy] = useState(false), [error, setError] = useState(''), [current, setCurrent] = useState<string | null>(null);
	const retained = useRef<readonly Input[]>([]), operation = useRef<AbortController | null>(null), alive = useRef(true);
	const macro = choices.find(choice => choice.id === selected && choice.enabled)?.macro;
	const available = fileService.isDesktop && typeof controller.actions.macros.applyToFiles === 'function';
	const release = useCallback(async (inputs: readonly Input[]): Promise<void> => {
		await Promise.allSettled(inputs.flatMap(input => [Promise.resolve(fileService.releaseRead(input.id)),
			...(input.originalFile ? [Promise.resolve(fileService.releaseOriginalFile(input.originalFile.id))] : [])]));
	}, [fileService]);
	useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current?.abort(); void release(retained.current); retained.current = []; }; }, [release]);
	const choose = (): void => {
		if (!available || operation.current) return;
		const cancellation = new AbortController(); operation.current = cancellation; setBusy(true); setError('');
		void (async () => {
			const chosen = (await fileService.chooseFiles({ purpose: 'audio', multiple: true })).filter(isInput);
			if (!chosen.length) return;
			if (cancellation.signal.aborted || !alive.current) { await release(chosen); return; }
			if (chosen.length > 100) { await release(chosen); throw new RangeError('Choose at most 100 audio files.'); }
			await release(retained.current);
			if (cancellation.signal.aborted || !alive.current) { await release(chosen); return; }
			retained.current = chosen; setFiles(chosen); setRows([]);
		})().catch((cause: unknown) => { if (alive.current && !cancellation.signal.aborted) setError(message(cause)); })
			.finally(() => { if (operation.current === cancellation) { operation.current = null; if (alive.current) setBusy(false); } });
	};
	const run = (): void => {
		if (!available || !macro || !files.length || operation.current) return;
		const cancellation = new AbortController(); operation.current = cancellation; setBusy(true); setError(''); setRows([]);
		const inputs = retained.current.slice();
		void (async () => {
			let directory: Directory | null = null;
			try {
				const names = inputs.map(input => `${sanitizeSuggestedFileName(input.name).replace(/\.[^.]+$/u, '').slice(0, 120)}-processed.${format}`);
				directory = await fileService.chooseBatchSaveDirectory(names) as Directory | null;
				if (!directory) return;
				cancellation.signal.throwIfAborted();
				const result = await controller.actions.macros.applyToFiles!({ macro, format, signal: cancellation.signal,
					items: inputs.map((input, index) => ({ input, target: { batchId: directory!.id, index, name: directory!.files[index]! } })),
					onProgress: (completed, _total, file) => { if (alive.current) { setRows(completed); setCurrent(file); } },
				});
				if (alive.current) setRows(result);
			} finally {
				try { if (directory) await fileService.releaseBatchSaveDirectory(directory.id); }
				finally { if (directory || cancellation.signal.aborted) { await release(inputs); retained.current = []; if (alive.current) setFiles([]); } }
			}
		})().catch((cause: unknown) => { if (alive.current && !cancellation.signal.aborted) setError(message(cause)); })
			.finally(() => { if (operation.current === cancellation) { operation.current = null; if (alive.current) { setBusy(false); setCurrent(null); } } });
	};
	const close = (): void => { operation.current?.abort(); onClose(); };
	const statuses = { completed: copy.macroBatchCompleted, failed: copy.macroBatchFailed, cancelled: copy.macroBatchCancelled, skipped: copy.macroBatchSkipped };
	return <AudioEditorDialogShell title={copy.macroApplyToFiles!} onClose={close} width={620}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={busy ? () => operation.current?.abort() : close}>{busy ? copy.cancel : copy.close}</Button>
			<Button variant="primary" disabled={!available || busy || !macro || !files.length} onClick={run}>{copy.macroBatchRun}</Button>
		</>} />}>
		<div className="kw-audio-editor-dialog__form" aria-busy={busy}>
			<p className="audio-editor-panel-hint">{available ? copy.macroBatchHint : copy.macroBatchDesktop}</p>
			<label className="kw-audio-editor-dialog__field"><span>{copy.macroBatchMacro}</span><select value={selected} disabled={busy} onChange={event => setSelected(event.currentTarget.value)}>
				{choices.map(choice => <option key={choice.id} value={choice.id} disabled={!choice.enabled}>{choice.macro.name}</option>)}
			</select></label>
			<label className="kw-audio-editor-dialog__field"><span>{copy.macroBatchFormat}</span><select value={format} disabled={busy} onChange={event => setFormat(event.currentTarget.value as MacroFileBatchFormat)}>
				<option value="wav">{copy.macroBatchWav}</option><option value="flac">{copy.macroBatchFlac}</option><option value="mp3">{copy.macroBatchMp3}</option>
			</select></label>
			<Button variant="secondary" onClick={choose} disabled={!available || busy}>{copy.macroBatchChooseFiles}</Button>
			{files.length > 0 && <ul>{files.map(input => <li key={input.id}>{input.name}</li>)}</ul>}
			{current && <p role="status">{current}</p>}
			{rows.length > 0 && <ul aria-live="polite">{rows.map((row, index) => <li key={index}>{row.name}: {statuses[row.status]}{row.message ? ` — ${row.message}` : ''}</li>)}</ul>}
			{!files.length && !rows.length && <p>{copy.macroBatchEmpty}</p>}
			{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
		</div>
	</AudioEditorDialogShell>;
}

function isInput(value: unknown): value is Input {
	return value !== null && typeof value === 'object' && typeof Reflect.get(value, 'id') === 'string' && typeof Reflect.get(value, 'name') === 'string';
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
