/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { resolveLocalAssistanceBridge } from '../../assistance/local-assistance-bridge.ts';
import { CORRIDORKEY_MODEL_ID, CORRIDORKEY_MODEL_VERSION, type VideoKeyingProgress } from '../../controller/assistance/local-assistance-video-keying.ts';
import { resolveCorridorKeyCopy } from '../../../i18n/editor-corridorkey-copy.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { resolveLocalModelManagerBridge } from '../local-model-manager-availability.ts';
import { localModelManagerStoreFor } from '../local-model-manager-store.ts';
import { framescaperCorridorKeyRuntimeFor } from '../framescaper-corridorkey-runtime.ts';
import AssistanceModelGate from './AssistanceModelGate.tsx';

interface Props {
	readonly bridgeScope: unknown;
	readonly controller: unknown;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale: string;
	readonly onClose: () => void;
}
const exactModel = (model: Readonly<{ modelId: string; version: string; task: string }>): boolean => (
	model.modelId === CORRIDORKEY_MODEL_ID && model.version === CORRIDORKEY_MODEL_VERSION && model.task === 'video-keying'
);

export default function CorridorKeyDialog(props: Props) {
	const modelBridge = useMemo(() => resolveLocalModelManagerBridge(props.bridgeScope), [props.bridgeScope]);
	const text = resolveCorridorKeyCopy(props.locale);
	return <AssistanceModelGate title={text.title} bridge={modelBridge} locale={props.locale}
		copy={{ ...props.copy, assistanceNoDownloadableModels: text.unavailable }}
		requiresModel modelFilter={exactModel} onClose={props.onClose}
		configuration={() => <><p>{text.description}</p><p>{text.supported}</p></>}>
		<CorridorKeyRunDialog {...props} />
	</AssistanceModelGate>;
}
function CorridorKeyRunDialog({ bridgeScope, controller, copy, locale, onClose }: Props) {
	const bridge = useMemo(() => resolveLocalAssistanceBridge(bridgeScope), [bridgeScope]);
	const modelBridge = useMemo(() => resolveLocalModelManagerBridge(bridgeScope), [bridgeScope]);
	const manager = useMemo(() => modelBridge ? localModelManagerStoreFor(modelBridge) : null, [modelBridge]);
	const runtime = framescaperCorridorKeyRuntimeFor(controller);
	const [progress, setProgress] = useState<VideoKeyingProgress | null>(null);
	const [error, setError] = useState('');
	const pending = useRef<AbortController | null>(null);
	const text = resolveCorridorKeyCopy(locale);
	useEffect(() => () => { pending.current?.abort(); }, []);
	const close = (): void => { pending.current?.abort(); onClose(); };
	const available = bridge !== null && bridge.videoKeying !== undefined && runtime !== null && manager !== null;
	async function runKeying(): Promise<void> {
		if (!available || !bridge || !runtime || !manager || pending.current) return;
		const cancellation = new AbortController(); pending.current = cancellation;
		setError(''); setProgress({ phase: 'decoding', completed: 0, total: null });
		try {
			await runtime.run({ bridge, signal: cancellation.signal,
				onProgress: (value) => { if (!cancellation.signal.aborted) setProgress(value); },
				preflightModel: async (signal) => {
					await manager.load(); signal.throwIfAborted();
					if (!manager.getSnapshot().models.some((model) => exactModel(model) && model.availability === 'installed')) throw new Error(text.unavailable);
					const models = (await bridge.models()).filter(exactModel); signal.throwIfAborted();
					if (models.length !== 1) throw new Error(text.unavailable);
					return models[0]!;
				},
			});
			if (!cancellation.signal.aborted) onClose();
		} catch (failure) {
			if (!cancellation.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			if (pending.current === cancellation) { pending.current = null;
				if (!cancellation.signal.aborted) setProgress(null); }
		}
	}
	return <AudioEditorDialogShell title={text.title} onClose={close} width={600}
		dataAttributes={{ 'data-corridorkey-dialog': 'true' }}
		footer={<DialogFooter rightContent={<>
			<Button variant="secondary" onClick={close}>{progress ? copy.cancel : copy.close}</Button>
			<Button variant="primary" disabled={!available || progress !== null} onClick={() => { void runKeying(); }}>{text.run}</Button>
		</>} />}>
		<p>{text.description}</p><p>{text.supported}</p>
		{!available && <p role="status">{text.unavailable}</p>}
		{progress && <div role="status"><p>{text[progress.phase]}</p>
			<progress aria-label={text[progress.phase]} value={progress.completed ?? undefined} max={progress.total ?? undefined} /></div>}
		{error && <p role="alert">{error}</p>}
	</AudioEditorDialogShell>;
}
