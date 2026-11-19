/* SPDX-License-Identifier: AGPL-3.0-only */

import { araFailureInfo, AraOperationError } from '../../ara-failure.ts'
import { araFailureLabel } from './ara-failure-presentation.ts'
import { EditorComponentCopyProvider } from '../EditorComponentCopyProvider.tsx'
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { DialogFooter } from '@soundscaper/design-system/Footer'
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx'
import NativeProcessingTheme from '../dialogs/NativeProcessingTheme.tsx'
import { ProcessingButton as Button } from '../dialogs/ProcessingButton.tsx'
import '../dialogs/ProcessingDialogs.css'
import { resolveAudioEditorDesktopBridge } from '../../file-service.js'
import { createAraEditSession } from '../../controller/effects/ara-edit-session.ts'
import { resolveAraClipEditingRuntime, type AraClipEditingRuntime } from '../../ara-clip-editing-runtime.ts'
import type { AraBridge } from '../../ara-contract.ts'
import { ARA_COPY_BY_LOCALE } from '../../../i18n/editor-ara-copy.ts'
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts'
import { captureNativeProcessingReturnFocus } from './native-processing-return-focus.ts'
import type { NativePluginAvailability, NativePluginRegistryView, NativePluginConsentAction, NativePluginScanOutcome } from '../soundscaper-native-services-bridge.ts'
import EditorControlLabel from '../EditorControlLabel.tsx';

interface AraDesktopBridge {
	readonly ara: AraBridge
	nativePluginAvailability(): Promise<NativePluginAvailability>
	listNativePlugins(): Promise<NativePluginRegistryView>
	setNativePluginInstallationAllowed(request: { installationId: string; allowed: boolean }): Promise<unknown>
	selectNativePluginInstallation(request: { installationId: string }): Promise<unknown>
	applyNativeTierControl?(request: { action: string; enabled: boolean }): Promise<unknown>
	setNativePluginConsent?(request: { format: string; action: NativePluginConsentAction; rootId?: string }): Promise<unknown>
	scanNativePlugins?(request: { format: string; rootId: string }): Promise<NativePluginScanOutcome>
}

interface AraController {
	subscribe(listener: () => void): () => void
}

const activeSurfaces = new WeakMap<object, () => void>()

/** Nothing is mounted until the existing Effect menu explicitly opens this surface. */
export function openAraClipEditorSurface(options: Readonly<{
	controller: unknown
	copy?: Readonly<Record<string, string | undefined>>
	locale?: string
}>): void {
	const runtime = resolveAraClipEditingRuntime(options.controller)
	const raw = resolveAudioEditorDesktopBridge() as unknown as Partial<AraDesktopBridge> | null
	if (!runtime || !raw?.ara || !['start', 'write', 'bind', 'openEditor', 'render', 'close']
		.every((key) => typeof (raw.ara as unknown as Record<string, unknown>)[key] === 'function')
		|| typeof raw.listNativePlugins !== 'function' || typeof raw.nativePluginAvailability !== 'function') {
		throw new Error(options.copy?.['ui.ara.unavailable'] ?? ARA_COPY_BY_LOCALE.en.unavailable)
	}
	const controller = options.controller as AraController
	activeSurfaces.get(controller)?.()
	const container = document.createElement('div')
	container.dataset.araSurface = 'true'
	const parent = document.querySelector('[data-audio-editor]') ?? document.body
	parent.append(container)
	const root = createRoot(container)
	const restoreFocus = captureNativeProcessingReturnFocus(document)
	let closed = false
	const onClose = (): void => {
		if (closed) return
		closed = true
		activeSurfaces.delete(controller)
		queueMicrotask(() => { root.unmount(); container.remove(); restoreFocus() })
	}
	activeSurfaces.set(controller, onClose)
	root.render(<EditorComponentCopyProvider copy={options.copy ?? {}} locale={options.locale ?? 'en'}><NativeProcessingTheme><AraClipEditorDialog bridge={raw as AraDesktopBridge}
		clipEditing={runtime} controller={controller} copy={options.copy} onClose={onClose} /></NativeProcessingTheme></EditorComponentCopyProvider>)
}

interface PluginOption { readonly installationId: string; readonly label: string }

export function AraClipEditorDialog({ bridge, clipEditing, controller, copy: hostCopy, onClose }: Readonly<{
	bridge: AraDesktopBridge
	clipEditing: AraClipEditingRuntime
	controller: AraController
	copy?: Readonly<Record<string, string | undefined>>
	onClose(): void
}>) {
	const copy = useMemo(() => resolveEditorCopyScope('ara', ARA_COPY_BY_LOCALE.en, hostCopy), [hostCopy])
	const session = useMemo(() => createAraEditSession({ bridge: bridge.ara, clipEditing }), [bridge, clipEditing])
	const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
	const [plugins, setPlugins] = useState<readonly PluginOption[]>([])
	const [installationId, setInstallationId] = useState('')
	const [discoveryBusy, setDiscoveryBusy] = useState(false)
	const [error, setError] = useState<unknown>(null)
	const [availability, setAvailability] = useState<NativePluginAvailability | null>(null)
	const inventoryRequest = useRef(0)
	const operation = useRef<AbortController | null>(null)
	const refresh = useCallback(async (): Promise<void> => {
		const request = ++inventoryRequest.current
		try {
			const [payload, registry] = await Promise.all([bridge.nativePluginAvailability(), bridge.listNativePlugins()])
			if (request !== inventoryRequest.current) return
			const options = registry.entries.filter((entry) => entry.format.toLowerCase() === 'vst3')
				.flatMap((entry) => entry.installations.filter((installation) => !installation.quarantined)
					.map((installation) => ({ installationId: installation.installationId,
						label: `${entry.name} ${installation.version} — ${entry.vendor}` })))
			setAvailability(payload)
			setPlugins(options)
			setInstallationId(current => options.some(option => option.installationId === current) ? current : '')
		} catch (failure) {
			if (request === inventoryRequest.current) throw failure
		}
	}, [bridge])
	useEffect(() => {
		void refresh().catch(setError)
		return () => { inventoryRequest.current += 1; operation.current?.abort() }
	}, [refresh])
	useEffect(() => {
		const unsubscribe = controller.subscribe(() => { void session.reconcile() })
		return () => { unsubscribe(); void session.dispose().catch(() => undefined) }
	}, [controller, session])
	useEffect(() => { if (state.phase === 'applied') onClose() }, [state.phase, onClose])
	const busy = discoveryBusy || state.phase === 'opening' || state.phase === 'rendering'
	const editing = state.phase === 'editing'
	const perform = (work: (signal: AbortSignal) => Promise<void>): void => {
		if (operation.current) return
		const owner = new AbortController()
		operation.current = owner
		setError(null)
		setDiscoveryBusy(true)
		void work(owner.signal).catch((failure: unknown) => { if (!owner.signal.aborted) setError(failure) })
			.finally(() => {
				if (operation.current === owner) operation.current = null
				if (!owner.signal.aborted) setDiscoveryBusy(false)
			})
	}
	const scan = async (custom: boolean, signal: AbortSignal): Promise<void> => {
		const scanNativePlugins = bridge.scanNativePlugins?.bind(bridge)
		if (!bridge.applyNativeTierControl || !bridge.setNativePluginConsent || !scanNativePlugins) {
			throw new AraOperationError('unavailable', copy.unavailable)
		}
		const scanRoot = async (rootId: string): Promise<void> => {
			signal.throwIfAborted()
			const outcome = await scanNativePlugins({ format: 'vst3', rootId })
			signal.throwIfAborted()
			if (outcome.status === 'failed') throw new AraOperationError('discovery-failed', outcome.message)
		}
		await bridge.applyNativeTierControl({ action: 'set-native-effect-discovery-enabled', enabled: true })
		signal.throwIfAborted()
		await bridge.setNativePluginConsent({ format: 'vst3', action: 'grant' })
		signal.throwIfAborted()
		if (custom) {
			const outcome = await bridge.setNativePluginConsent({ format: 'vst3', action: 'add-custom-root' })
			signal.throwIfAborted()
			if (outcome && typeof outcome === 'object' && 'status' in outcome) {
				if (outcome.status === 'declined') return
				if (outcome.status === 'admitted' && 'root' in outcome && outcome.root && typeof outcome.root === 'object'
					&& 'rootId' in outcome.root && typeof outcome.root.rootId === 'string') {
					await scanRoot(outcome.root.rootId)
					await refresh()
					return
				}
				if (outcome.status === 'refused' && 'message' in outcome) throw new Error(String(outcome.message))
			}
			throw new AraOperationError('discovery-failed', copy.discoveryFailed)
		}
		const payload = await bridge.nativePluginAvailability()
		signal.throwIfAborted()
		const format = payload.consent.formats.find((format) => format.format.toLowerCase() === 'vst3')
		for (const root of format?.roots ?? []) {
			if (!root.admitted) await bridge.setNativePluginConsent({ format: 'vst3', action: 'add-standard-root', rootId: root.rootId })
			await scanRoot(root.rootId)
		}
		await refresh()
	}
	const close = (): void => {
		operation.current?.abort()
		inventoryRequest.current += 1
		void session.dispose().catch(() => undefined)
		onClose()
	}
	return <AudioEditorDialogShell title={copy.title} onClose={close} width={680}
		dataAttributes={{ 'data-ara-clip-editor': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button onClick={close}>{copy.cancel}</Button>
			<Button variant="primary" disabled={!editing || busy} onClick={() => { void session.apply() }}>{copy.render}</Button>
		</>} />}>
		<p>{copy.description}</p>
		<div className="audio-editor-soundscaper-native-services">
			<label><EditorControlLabel>{copy.plugin} </EditorControlLabel><select aria-label={copy.plugin} value={installationId} disabled={busy || editing}
				onChange={(event) => setInstallationId(event.target.value)}>
				<option value="">{copy.choosePlugin}</option>
				{plugins.map((plugin) => <option key={plugin.installationId} value={plugin.installationId}>{plugin.label}</option>)}
			</select></label>
			<p role="status" aria-live="polite">{error ? araFailureLabel(araFailureInfo(error, 'discovery-failed').code, copy) : state.message ? araFailureLabel(state.failureCode, copy) : (state.phase === 'opening' ? copy.opening
				: state.phase === 'rendering' ? copy.rendering : editing ? copy.editing
					: plugins.length === 0 ? availability?.payload.status === 'unavailable' ? copy.unavailable : copy.noPlugins : '')}</p>
			{(Boolean(error) || state.message) && <details><summary>{hostCopy?.reportItemDiagnostic || 'Original diagnostic'}</summary>{error ? araFailureInfo(error).diagnostic : state.message}</details>}
			{busy && <progress max={1} value={state.progress} aria-label={state.phase === 'rendering' ? copy.rendering : copy.opening} />}
			<div className="audio-editor-dialog-buttons">
				<Button disabled={busy || editing} onClick={() => perform(refresh)}>{copy.refresh}</Button>
				<Button disabled={busy || editing} onClick={() => perform(signal => scan(false, signal))}>{copy.scan}</Button>
				<Button disabled={busy || editing} onClick={() => perform(signal => scan(true, signal))}>{copy.customFolder}…</Button>
				<Button disabled={busy || editing || !installationId} onClick={() => perform(async signal => {
					await bridge.setNativePluginInstallationAllowed({ installationId, allowed: true })
					signal.throwIfAborted()
					await bridge.selectNativePluginInstallation({ installationId })
					signal.throwIfAborted()
					await session.open(installationId)
				})}>{copy.openClip}</Button>
				<Button disabled={!editing || busy} onClick={() => { void session.openEditor() }}>{copy.openEditor}</Button>
			</div>
		</div>
	</AudioEditorDialogShell>
}
