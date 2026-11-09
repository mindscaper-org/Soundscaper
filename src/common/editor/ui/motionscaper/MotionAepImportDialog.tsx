/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { createNativeAepImportService, type PreparedNativeAepImport } from '../../controller/import/native-aep-import.ts';
import type { AepFootage } from '../../aep-project-reader.ts';
import type { MotionscaperProjectStore } from '../../../../motionscaper/editor-project-store.ts';
import { prepareMotionFont } from '../../motion-font-import.ts';
import { loadMotionRasterRuntime } from '../../controller/composition/motion-raster-runtime.ts';
function download(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name;
	try { document.body.append(link); link.click(); } finally { link.remove(); globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export default function MotionAepImportDialog({ store, copy, busy, onOpen, onClose, initialFile }: Readonly<{
	store: MotionscaperProjectStore; copy: Readonly<Record<string, string>>; busy: boolean; initialFile?: File;
	onOpen(id: string): Promise<void>; onClose(): void;
}>) {
	const id = useId(), active = useRef<AbortController | null>(null), mounted = useRef(true);
	const [service] = useState(() => createNativeAepImportService({ begin: project => store.beginImport(project), prepareFont: async (body, id, name, signal) => {
		const runtime = await loadMotionRasterRuntime(signal); return await prepareMotionFont(body, { id, name, style: 'Regular' }, runtime.kit, signal);
	} }));
	const [file, setFile] = useState<File | null>(initialFile ?? null), [media, setMedia] = useState<ReadonlyMap<number, File>>(new Map());
	const [sources, setSources] = useState<readonly AepFootage[]>([]), [prepared, setPrepared] = useState<PreparedNativeAepImport | null>(null);
	const [fontNames, setFontNames] = useState<readonly string[]>([]), [fonts, setFonts] = useState<ReadonlyMap<string, File>>(new Map());
	const [cleanupRequired, setCleanupRequired] = useState(false);
	const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null), [acknowledged, setAcknowledged] = useState(false);
	const [page, setPage] = useState(0), [importedId, setImportedId] = useState<string | null>(null);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
	const disabled = busy || working;
	const reset = () => { setPrepared(null); setAcknowledged(false); setImportedId(null); setPage(0); setError(null); };
	const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
		if (disabled || active.current) return;
		const abort = new AbortController(); active.current = abort; setWorking(true); setError(null);
		try { await operation(abort.signal); }
		catch (failure) { if (mounted.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
		finally { active.current = null; if (mounted.current) setWorking(false); }
	};
	const review = () => run(async signal => {
		if (!file) return; reset();
		const result = await service.prepare({ file, name: file.name, media: [...media].map(([sourceId, file]) => ({ sourceId, file, name: file.name })), fonts: [...fonts].map(([postScriptName, file]) => ({ postScriptName, file })) }, signal);
		signal.throwIfAborted(); if (mounted.current) { setPrepared(result); setSources(result.media); setFontNames(result.fonts); }
	});
	const publish = () => run(async signal => {
		if (importedId) { await onOpen(importedId); return; }
		if (!prepared || !acknowledged) return;
		try { const project = await service.commit(prepared, acknowledged, signal); if (mounted.current) setImportedId(project.id); await onOpen(project.id); }
		finally { if (mounted.current) setCleanupRequired(service.needsCleanup(prepared)); }
	});
	const report = prepared?.project.nativeImport?.report ?? [], rows = report.slice(page * 50, page * 50 + 50);
	return <AudioEditorDialogShell title={copy.motionscaperAepImport} width={860} onClose={disabled || cleanupRequired ? undefined : onClose}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>{working && <Button variant="secondary" onClick={() => active.current?.abort()}>{copy.motionscaperCancel}</Button>}<Button variant="secondary" disabled={disabled || cleanupRequired} onClick={onClose}>{copy.motionscaperClose}</Button></>} />}>
		<p>{copy.motionscaperAepHint}</p><p>{copy.motionscaperAepCustody}</p><p>{copy.motionscaperAepLimits}</p>
		<fieldset disabled={disabled || cleanupRequired || Boolean(importedId)}><legend>{copy.motionscaperAepSource}</legend>
			<label htmlFor={`${id}-project`}>{copy.motionscaperAepSource}</label><input id={`${id}-project`} type="file" accept=".aep,.aepx" onChange={event => {
				reset(); setFile(event.currentTarget.files?.[0] ?? null); setSources([]); setMedia(new Map()); setFontNames([]); setFonts(new Map());
			}} />{file && <p>{file.name}</p>}
			{sources.map(source => <label key={source.id}>{copy.motionscaperAepMedia} — {source.name}<input type="file" disabled={source.sequence}
				onChange={event => { const selected = event.currentTarget.files?.[0]; reset(); setMedia(before => { const next = new Map(before); if (selected) next.set(source.id, selected); else next.delete(source.id); return next; }); }} /></label>)}
			{fontNames.map(name => <label key={name}>{copy.motionscaperAeTextFontFile} — {name}<input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={event => {
				const selected = event.currentTarget.files?.[0]; reset(); setFonts(before => { const next = new Map(before); if (selected) next.set(name, selected); else next.delete(name); return next; });
			}} /></label>)}
			<Button variant="secondary" disabled={!file} onClick={() => { void review(); }}>{copy.motionscaperAeReview}</Button>
		</fieldset>
		{prepared && <section aria-label={copy.motionscaperAeReport}>
			<h3>{prepared.project.title}</h3>
			<table><thead><tr><th>{copy.motionscaperAeReportScope}</th><th>{copy.motionscaperAeReportMapping}</th><th>{copy.motionscaperAeReportDetail}</th></tr></thead>
				<tbody>{rows.map((row, index) => <tr key={page * 50 + index}><td>{row.scopeId} {row.propertyPath}</td><td>{copy[`motionscaperAeStatus_${row.status}`]}</td><td>{row.message}</td></tr>)}</tbody></table>
			{report.length > 50 && <div><Button variant="secondary" disabled={!page} onClick={() => setPage(value => value - 1)}>{copy.motionscaperAePrevious}</Button><span>{page + 1}/{Math.ceil(report.length / 50)}</span><Button variant="secondary" disabled={(page + 1) * 50 >= report.length} onClick={() => setPage(value => value + 1)}>{copy.motionscaperAeNext}</Button></div>}
			<Button variant="secondary" disabled={disabled} onClick={() => download(new Blob([JSON.stringify(prepared.project.nativeImport)], { type: 'application/json' }), 'Motionscaper-AEP-Import-Report.json')}>{copy.motionscaperAepReport}</Button>
			{file && <Button variant="secondary" disabled={disabled} onClick={() => download(file, file.name)}>{copy.motionscaperAepOriginal}</Button>}
			<label><input type="checkbox" disabled={disabled || cleanupRequired || Boolean(importedId)} checked={acknowledged} onChange={event => setAcknowledged(event.currentTarget.checked)} />{copy.motionscaperAeAcknowledge}</label>
			<Button variant="secondary" disabled={disabled || cleanupRequired || (!acknowledged && !importedId)} onClick={() => { void publish(); }}>{importedId ? copy.motionscaperAeOpenImported : copy.motionscaperAeImport}</Button>
		</section>}
		{cleanupRequired && <div role="alert">{copy.motionscaperAeCleanupRequired}<Button variant="secondary" disabled={disabled} onClick={() => { void run(async () => { if (prepared) { await service.retryCleanup(prepared); setCleanupRequired(false); } }); }}>{copy.motionscaperAeRetryCleanup}</Button></div>}
		{working && <p role="status">{copy.motionscaperWorking}</p>}{error && <p role="alert">{copy.motionscaperAepFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
