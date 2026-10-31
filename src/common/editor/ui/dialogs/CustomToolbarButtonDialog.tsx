/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useId, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import { MUSESCORE_ICON_CODES } from '../../audacity-iconcodes.js';
import type { CustomToolbarButton } from '../../custom-toolbar-buttons.ts';
import { createCustomToolbarButtonImage, MAX_CUSTOM_TOOLBAR_IMAGE_BYTES } from '../../custom-toolbar-button-image.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { CustomToolbarButtonAction } from '../toolbar/custom-toolbar-button-actions.ts';
import CustomToolbarButtonSymbol from '../toolbar/CustomToolbarButtonSymbol.tsx';
import CustomToolbarActionPicker from './CustomToolbarActionPicker.tsx';
import { prepareCustomToolbarSymbolSearch } from './custom-toolbar-button-search.ts';
import './CustomToolbarButtonDialog.css';

interface Props {
	readonly button?: CustomToolbarButton | null;
	readonly copy: Record<string, string>;
	readonly actions: readonly CustomToolbarButtonAction[];
	readonly onSave: (button: CustomToolbarButton) => Promise<unknown>;
	readonly onRemove?: () => Promise<unknown>;
	readonly onClose: () => void;
}

const SYMBOLS = Object.freeze(Object.keys(MUSESCORE_ICON_CODES));

export default function CustomToolbarButtonDialog({ button, copy, actions, onSave, onRemove, onClose }: Props) {
	const formId = useId();
	const descriptionId = useId();
	const [name, setName] = useState(button?.name ?? '');
	const [actionId, setActionId] = useState(button?.actionId ?? '');
	const [icon, setIcon] = useState(button?.icon ?? 'PLUS');
	const [uploadedIcon, setUploadedIcon] = useState(button?.icon.startsWith('data:image/') ? button.icon : '');
	const [loadingIcon, setLoadingIcon] = useState(false);
	const [imageFailure, setImageFailure] = useState('');
	const [symbolSearch, setSymbolSearch] = useState('');
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [failure, setFailure] = useState('');
	const selectedAction = actions.find((action) => action.actionId === actionId);
	const findSymbols = useMemo(() => prepareCustomToolbarSymbolSearch(SYMBOLS), []);
	const matchingSymbols = findSymbols(symbolSearch);
	const canSave = name.trim().length > 0 && Boolean(selectedAction) && !saving && !loadingIcon;
	const persist = (operation: () => Promise<unknown>) => {
		if (savingRef.current) return;
		savingRef.current = true;
		setSaving(true);
		setFailure('');
		void Promise.resolve().then(operation).then(onClose).catch((error: unknown) => {
			setFailure(error instanceof Error ? error.message : String(error));
			savingRef.current = false;
			setSaving(false);
		});
	};
	return <AudioEditorDialogShell
		title={copy.customToolbarButton}
		onClose={saving ? undefined : onClose}
		width={640}
		initialFocus="input[name='custom-button-name']"
		className="kw-audio-editor-custom-button-dialog"
		ariaDescribedBy={descriptionId}
		footer={<DialogFooter className="audio-editor-dialog-footer"
			leftContent={button && onRemove ? <Button variant="secondary" disabled={saving} onClick={() => persist(onRemove)}>{copy.customToolbarButtonRemove}</Button> : undefined}
			rightContent={<>
				<Button variant="secondary" disabled={saving} onClick={onClose}>{copy.cancel}</Button>
				<Button type="submit" form={formId} variant="primary" disabled={!canSave}>{copy.save}</Button>
			</>}
		/>}
	>
		<form id={formId} onSubmit={(event) => {
			event.preventDefault();
			if (canSave) persist(() => onSave({ id: button?.id ?? `custom-${globalThis.crypto.randomUUID()}`, name: name.trim(), icon, actionId }));
		}}>
			<p id={descriptionId}>{copy.customToolbarButtonHelp}</p>
			<label className="kw-audio-editor-custom-button-dialog__field">
				<span>{copy.customToolbarButtonName}</span>
				<input name="custom-button-name" aria-label={copy.customToolbarButtonName} value={name} onChange={(event) => setName(event.currentTarget.value)} required disabled={saving} />
			</label>
			<CustomToolbarActionPicker actions={actions} actionId={actionId} copy={copy} disabled={saving} onSelect={setActionId} />
			{actionId && (!selectedAction || selectedAction.disabled) && <p>{selectedAction?.disabledReason || copy.customToolbarButtonUnavailable}</p>}
			<label className="kw-audio-editor-custom-button-dialog__field">
				<span>{copy.customToolbarButtonSymbolSearch}</span>
				<input type="search" aria-label={copy.customToolbarButtonSymbolSearch} value={symbolSearch} onChange={(event) => setSymbolSearch(event.currentTarget.value)} disabled={saving} />
			</label>
			<div className="kw-audio-editor-custom-button-dialog__symbol-heading">
				<span>{copy.customToolbarButtonSymbol}: {icon === uploadedIcon ? copy.customToolbarButtonUploadedSymbol : icon.replaceAll('_', ' ')}</span>
				<CustomToolbarButtonSymbol icon={icon} />
			</div>
			<label className="kw-audio-editor-custom-button-dialog__field">
				<span>{copy.customToolbarButtonUploadSymbol}</span>
				<input type="file" accept=".png,.svg,image/png,image/svg+xml" aria-label={copy.customToolbarButtonUploadSymbol}
					disabled={saving || loadingIcon} onChange={(event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = '';
						if (!file) return;
						setImageFailure('');
						if (file.size > MAX_CUSTOM_TOOLBAR_IMAGE_BYTES) { setImageFailure(copy.customToolbarButtonSymbolTooLarge); return; }
						setLoadingIcon(true);
						void file.arrayBuffer().then(async (buffer) => {
							const imageIcon = createCustomToolbarButtonImage(new Uint8Array(buffer));
							const image = new Image();
							image.src = imageIcon;
							await image.decode();
							setUploadedIcon(imageIcon); setIcon(imageIcon);
						}).catch(() => setImageFailure(copy.customToolbarButtonSymbolInvalid)).finally(() => setLoadingIcon(false));
					}} />
			</label>
			{imageFailure && <p role="alert">{imageFailure}</p>}
			<div className="kw-audio-editor-custom-button-dialog__symbols" role="group" aria-label={copy.customToolbarButtonSymbol}>
				{uploadedIcon && <button type="button" aria-label={copy.customToolbarButtonUploadedSymbol} aria-pressed={icon === uploadedIcon} disabled={saving || loadingIcon} onClick={() => setIcon(uploadedIcon)}>
					<CustomToolbarButtonSymbol icon={uploadedIcon} />
				</button>}
				{matchingSymbols.map((symbol) => <button key={symbol} type="button" aria-label={symbol} aria-pressed={icon === symbol} title={symbol.replaceAll('_', ' ')} disabled={saving || loadingIcon} onClick={() => setIcon(symbol)}>
					<CustomToolbarButtonSymbol icon={symbol} />
				</button>)}
				{matchingSymbols.length === 0 && <p role="status">{copy.customToolbarButtonNoSymbols}</p>}
			</div>
			{failure && <p role="alert">{failure}</p>}
		</form>
	</AudioEditorDialogShell>;
}
