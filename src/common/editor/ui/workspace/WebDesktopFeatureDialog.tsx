/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { desktopDownloadUrl } from '../../desktop-download-links.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface Props {
	readonly copy: Readonly<{
		webDesktopFeatureTitle: string;
		webDesktopFeatureDescription: string;
		webDesktopFeatureDownload: string;
		cancel: string;
	}>;
	readonly productId: string;
	readonly onClose: () => void;
}

export default function WebDesktopFeatureDialog({ copy, productId, onClose }: Props) {
	const descriptionId = useId();
	const download = (): void => {
		const opened = globalThis.open?.(desktopDownloadUrl(productId), '_blank', 'noopener,noreferrer');
		if (opened) opened.opener = null;
		onClose();
	};
	return <AudioEditorDialogShell title={copy.webDesktopFeatureTitle} onClose={onClose}
		ariaDescribedBy={descriptionId}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="primary" onClick={download}>{copy.webDesktopFeatureDownload}</Button>
			<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
		</>} />}
	>
		<p id={descriptionId}>{copy.webDesktopFeatureDescription}</p>
	</AudioEditorDialogShell>;
}
