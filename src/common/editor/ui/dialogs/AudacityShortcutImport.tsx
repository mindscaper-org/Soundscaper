/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import { KEYBOARD_MAP_COPY_BY_LOCALE } from '../../../i18n/editor-keyboard-map-copy.ts';
import { createShortcutImportSession, type ShortcutImportSession, type ShortcutImportSource } from '../../controller/preferences/shortcut-import-session.ts';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';
import { isReservedVideoNavigationShortcut } from './shortcut-editor-reservations.ts';
import type { ShortcutEditorCommand } from './ShortcutEditorRow.tsx';

type ShortcutMap = Readonly<Record<string, readonly string[]>>;
interface Props {
	readonly productId: string;
	readonly commands: readonly ShortcutEditorCommand[];
	readonly shortcuts: ShortcutMap;
	readonly copy: Readonly<Record<string, string>>;
	readonly controller: { readonly actions: { readonly preferences: {
		readonly update: (changes: { readonly shortcuts: ShortcutMap }) => unknown;
	} } };
	readonly run: (operation: () => unknown) => unknown;
}

export default function AudacityShortcutImport({ productId, commands, shortcuts, copy, controller, run }: Props) {
	const labels = resolveEditorCopyScope('keyboardMap', KEYBOARD_MAP_COPY_BY_LOCALE.en, copy);
	const inputRef = useRef<HTMLInputElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const [source, setSource] = useState<ShortcutImportSource | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<'invalid' | 'too-large' | null>(null);
	const [importedCount, setImportedCount] = useState<number | null>(null);
	const sessionRef = useRef<ShortcutImportSession | null>(null);
	useEffect(() => {
		const session = createShortcutImportSession({
			loadImporter: () => import('../../audacity-shortcut-import.ts'),
			saveShortcuts: shortcuts => runAwaitedAudioEditorOperation(run, () => controller.actions.preferences.update({ shortcuts })),
			onSource: setSource, onBusy: setBusy, onReadError: setError,
			onImported: count => {
				setImportedCount(count);
				if (count !== null) queueMicrotask(() => buttonRef.current?.focus());
			},
		});
		sessionRef.current = session;
		return () => { session.dispose(); sessionRef.current = null; };
	}, [controller, run]);
	const review = useMemo(() => {
		if (!source) return null;
		try {
			return { plan: source.parse(source.xml, shortcuts, {
				availableActionIds: commands.filter(command => !command.disabled).map(command => command.id),
				isReservedBinding: binding => isReservedVideoNavigationShortcut(productId, binding),
			}), invalid: false };
		} catch {
			return { plan: null, invalid: true };
		}
	}, [source, shortcuts, commands, productId]);
	const plan = review?.plan;
	const cancel = () => {
		sessionRef.current?.cancel();
		buttonRef.current?.focus();
	};
	const commandLabels = new Map(commands.map(command => [command.id, command.label]));
	const skipLabels = {
		'unsupported-command': labels.importSkipUnsupported,
		'invalid-shortcut': labels.importSkipInvalid,
		'reserved-shortcut': labels.importSkipReserved,
		'duplicate-shortcut': labels.importSkipDuplicate,
	};
	return <div aria-busy={busy}>
		<Button ref={buttonRef} variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{labels.importAudacity}</Button>
		<input ref={inputRef} type="file" accept=".xml,application/xml,text/xml" hidden aria-label={labels.audacityImportFile}
			onChange={event => {
				const file = event.currentTarget.files?.[0];
				event.currentTarget.value = '';
				if (file) void sessionRef.current?.read(file);
			}} />
		<p>{labels.importHelp}</p>
		{(error || review?.invalid) && <p role="alert">{error === 'too-large' ? labels.importTooLarge : labels.importInvalid}</p>}
		{importedCount !== null && <p role="status">{importedCount === 1 ? labels.importDoneSingle : labels.importDone.replace('{count}', String(importedCount))}</p>}
		{plan && <section role="region" aria-label={labels.importReview}>
			<p role="status">{(plan.importedCount === 1 ? labels.importSummarySingle : labels.importSummary).replace('{count}', String(plan.importedCount)).replace('{skipped}', String(plan.skipped.length))}</p>
			{plan.reassignedCount > 0 && <p>{labels.importReassigned.replace('{count}', String(plan.reassignedCount))}</p>}
			<details><summary>{labels.importPreview}</summary><ul>
				{Object.entries(plan.shortcuts).filter(([id, bindings]) => JSON.stringify(bindings) !== JSON.stringify(shortcuts[id] ?? []))
					.map(([id, bindings]) => <li key={id}>{commandLabels.get(id) ?? id}: {bindings.join(', ') || labels.importUnassigned}</li>)}
			</ul></details>
			{plan.skipped.length > 0 && <details><summary>{labels.importSkipped}</summary><ul>
				{plan.skipped.map((entry, index) => <li key={index}>{entry.command}{entry.binding ? ` (${entry.binding})` : ''}: {skipLabels[entry.reason]}</li>)}
			</ul></details>}
			<div className="kw-audio-editor__custom-workspace-actions">
				<Button variant="primary" disabled={busy || !plan.importedCount} onClick={() => { void sessionRef.current?.apply(plan); }}>{labels.importApply}</Button>
				<Button variant="secondary" disabled={busy} onClick={cancel}>{copy.cancel}</Button>
			</div>
		</section>}
	</div>;
}
