/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ENGLISH_COPY } from '../../../i18n/catalogs.js';
import { createPluginPresetSession, type PluginPreset } from '../../controller/effects/plugin-preset-session.ts';
import { effectPresetChoices, samePresetParams } from './effect-helpers.ts';
import { createAudioEditorFileService } from '../../file-service.js';
import { effectPluginKey, isPluginEffectType } from '../../effect-plugin-identity.ts';
import type { EffectAboutSubject } from './effect-about-metadata.ts';
import EffectPresetBar from './EffectPresetBar.jsx';
import { useEffectPluginHeaderHost } from './effect-plugin-header-host.ts';
import { useEffectAutoIdleOption } from './useEffectAutoIdleOption.ts';

export interface PluginEffectPresetHeaderProps {
	readonly controller?: unknown;
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly effectType: string;
	readonly name: string;
	readonly resetKey: string;
	readonly disabled?: boolean;
	readonly realtime?: boolean;
	readonly enabled?: boolean;
	readonly onEnabledChange?: (enabled: boolean) => PromiseLike<unknown> | unknown;
	readonly read: () => PromiseLike<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>;
	readonly apply: (params: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
	readonly currentParams?: Readonly<Record<string, unknown>>;
	readonly defaultParams?: Readonly<Record<string, unknown>>;
	readonly onAdvancedSettings?: (() => void) | null;
	readonly aboutEffect?: EffectAboutSubject | string;
	readonly fileService?: { saveFile(options: { purpose: string; suggestedName: string; mimeType: string; text: string }): PromiseLike<unknown> | unknown };
}

/** Plug-in formats adapt state capture/application; all presentation stays in EffectPresetBar. */
export default function PluginEffectPresetHeader(props: PluginEffectPresetHeaderProps) {
	const { host, snapshot } = useEffectPluginHeaderHost(props.controller);
	const copy = { ...ENGLISH_COPY, ...props.copy };
	const defaultFileService = useMemo(() => createAudioEditorFileService(), []);
	const latest = useRef(props);
	latest.current = props;
	const session = useMemo(() => {
		const projectId = snapshot.project?.id;
		const resetKey = props.resetKey;
		return host ? createPluginPresetSession({
			effectType: props.effectType, library: host.actions.effects.presets,
			isCurrent: () => host.getSnapshot().project?.id === projectId && latest.current.resetKey === resetKey,
			read: () => latest.current.read(), apply: params => latest.current.apply(params),
		}) : null;
	}, [host, props.effectType, props.resetKey, snapshot.project?.id]);
	useEffect(() => {
		session?.activate(); owner.current = session;
		return () => { session?.dispose(); if (owner.current === session) owner.current = null; };
	}, [session]);
	const [selection, setSelection] = useState<{ session: typeof session; id: string } | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');
	const owner = useRef(session);
	owner.current = session;
	useEffect(() => { setPending(false); setError(''); }, [session]);
	const selectedId = selection?.session === session ? selection.id : '';
	const presets = host?.actions.effects.presets.list(props.effectType) ?? [];
	const selected = presets.find(preset => preset.id === selectedId);
	const run = (operation: () => PromiseLike<unknown> | unknown): Promise<boolean> => {
		const current = session;
		setPending(true); setError('');
		return Promise.resolve().then(operation).then(() => true).catch((failure: unknown) => {
			if (owner.current === current) setError(failure instanceof Error ? failure.message : String(failure));
			return false;
		}).finally(() => { if (owner.current === current) setPending(false); });
	};
	const autoIdle = useEffectAutoIdleOption(props.controller, effectPluginKey({ type: props.effectType }), props.name, operation => { void run(operation); }, props.realtime === true);
	const apply = (preset: PluginPreset): void => {
		void run(async () => {
			if (await session?.apply(preset) && owner.current === session) setSelection({ session, id: preset.id });
		});
	};
	const save = (name: string, id?: string): Promise<boolean> => run(async () => {
		const saved = await session?.save(name, id);
		if (saved && owner.current === session) setSelection({ session, id: saved.id });
	});
	return <>
		<EffectPresetBar copy={copy} resetKey={session} disabled={props.disabled || pending || !host}
			automation={props.realtime ? { enabled: props.enabled !== false, onToggle: (enabled: boolean) => {
				if (!props.disabled && !pending) void run(() => props.onEnabledChange?.(enabled));
			} } : null}
			autoIdle={autoIdle} aboutEffect={props.aboutEffect ?? null} onAdvancedSettings={props.onAdvancedSettings ?? null}
			presets={effectPresetChoices(presets, copy.noEffectPreset, copy)}
			selectedId={selected?.id ?? ''} unsaved={Boolean(selected) && (!props.currentParams || !samePresetParams(props.currentParams, selected?.params))}
			defaultParams={props.defaultParams ?? null} currentParams={props.currentParams ?? null}
			onDefault={props.defaultParams ? () => { void run(async () => {
				if (await session?.apply({ id: '', effectType: props.effectType, name: '', params: props.defaultParams! }) && owner.current === session) setSelection(null);
			}); } : null}
			onSelect={(id: string) => { const preset = presets.find(candidate => candidate.id === id); if (preset) apply(preset); else setSelection(null); }}
			onSave={() => { if (selected) void save(selected.name, selected.id); }}
			onSaveAs={(name: string) => save(name)}
			onReset={() => { if (selected) apply(selected); }}
			onDelete={() => { void run(async () => { if (selected) await host?.actions.effects.presets.delete(selected.id); if (owner.current === session) setSelection(null); }); }}
			onImport={(file: File) => { void run(async () => {
				const text = await file.text();
				if (owner.current === session) await host?.actions.effects.presets.import(text, { effectType: props.effectType, sourceName: file.name });
			}); }}
			onExport={() => { void run(() => {
				if (!selected || !host) return;
				return (props.fileService ?? defaultFileService).saveFile({ purpose: 'preset',
					suggestedName: `${selected.name.replace(/[^\p{L}\p{N}_-]+/gu, '-')}.json`, mimeType: 'application/json',
					text: host.actions.effects.presets.export(selected.id) });
			}); }} acceptAudacityPresets={!isPluginEffectType(props.effectType)} />
		{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
	</>;
}
