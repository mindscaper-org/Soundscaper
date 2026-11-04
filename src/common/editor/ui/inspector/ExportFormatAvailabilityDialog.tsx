/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { useId } from 'react';
import { desktopCodecMessage, type DesktopCodecCopy } from '../../desktop-codec-presentation.ts';
import type { ExportFormatProblem } from '../../controller/export/export-format-availability.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface Props {
	readonly problem: ExportFormatProblem | null;
	readonly installing: boolean;
	readonly format: string;
	readonly sampleRate: string | number;
	readonly channelCount: number;
	readonly copy: DesktopCodecCopy;
	readonly onClose: () => void;
	readonly onInstall: () => Promise<void>;
}

export default function ExportFormatAvailabilityDialog({
	problem, installing, format, sampleRate, channelCount, copy, onClose, onInstall,
}: Props) {
	const descriptionId = useId();
	if (!problem) return null;
	const parameters = { format, sampleRate, channels: channelCount };
	const missing = problem.kind === 'missing-ffmpeg';
	const failure = problem.failure;
	const title = desktopCodecMessage(missing ? 'codecMissingTitle' : 'codecUnavailableTitle', copy, parameters);
	const message = desktopCodecMessage(failure.reasonCode === 'install-failed' ? 'codecInstallFailed'
		: missing ? 'codecMissingBody' : failure.reasonCode === 'custom-unsupported' ? 'codecCustomUnsupported'
			: failure.reasonCode === 'probe-failed' ? 'codecProbeFailed'
				: failure.reasonCode === 'unsupported-settings' ? 'codecUnsupportedSettings' : 'codecUnavailableBody', copy, parameters);
	const detail = failure.missingCapabilities?.length
		? desktopCodecMessage('codecMissingComponents', copy, { components: failure.missingCapabilities.join(', ') })
		: failure.cause || (problem.ffmpegState !== 'ready' ? problem.detail : '');
	return <AudioEditorDialogShell
		title={title} role="alertdialog" width={480} ariaDescribedBy={descriptionId}
		onClose={onClose} closeOnOutside={!installing}
		footer={<DialogFooter rightContent={<>
			<Button variant="secondary" onClick={onClose}>{copy.close || copy.cancel}</Button>
			{missing && <Button variant="primary" disabled={installing || !problem.canInstall}
				onClick={() => { void onInstall(); }}>{desktopCodecMessage(installing ? 'codecInstalling' : 'codecInstall', copy)}</Button>}
		</>} />}
	>
		<p id={descriptionId}>{message}</p>
		{detail && <p role="status">{detail}</p>}
		{missing && !problem.canInstall && <p>{desktopCodecMessage('codecManualInstall', copy)}</p>}
	</AudioEditorDialogShell>;
}
