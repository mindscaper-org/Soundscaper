import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { type FormEvent, useState } from 'react';

import type { FramescaperNativeServicesCopy } from '../framescaper-native-services-copy.ts';
import type {
	FramescaperNativeProjectActionRuntime,
	FramescaperNativeProjectActionSurface,
} from '../framescaper-native-project-actions.ts';

export default function FramescaperNativeProjectActionPanel({
	copy, surface, projectActions, title,
}: Readonly<{
	readonly copy: FramescaperNativeServicesCopy;
	readonly surface: FramescaperNativeProjectActionSurface;
	readonly projectActions: FramescaperNativeProjectActionRuntime;
	readonly title: string;
}>) {
	const [status, setStatus] = useState<'ready' | 'working' | 'complete'>('ready');
	const [error, setError] = usePresentationFeedback(copy);
	const run = (request?: unknown): void => {
		setStatus('working');
		setError('');
		void projectActions.run(surface, request).then(
			(result) => setStatus(result?.cancelled ? 'ready' : 'complete'),
			(failure: unknown) => {
				setStatus('ready');
				setError(feedbackFailure(failure));
			},
		);
	};
	const statusLine = <p role="status" aria-live="polite">{error || (status === 'ready'
		? copy.projectActionReady
		: status === 'working' ? copy.working : copy.projectActionComplete)}</p>;
	if (surface === 'image-sequence-import') {
		return <ImageSequenceImportPanel {...{ copy, title, status, statusLine, run }} />;
	}
	if (surface === 'render-queue-enqueue') {
		return <RenderQueueDeliveryPanel {...{ copy, title, status, statusLine, run }} />;
	}
	return <section aria-label={title}>
		{statusLine}
		<p><button type="button" disabled={status === 'working'}
			data-framescaper-native-project-action={surface}
			onClick={() => run()}>{copy.projectActionRun}</button></p>
	</section>;
}

interface SpecializedPanelProps {
	readonly copy: FramescaperNativeServicesCopy;
	readonly title: string;
	readonly status: 'ready' | 'working' | 'complete';
	readonly statusLine: React.ReactNode;
	readonly run: (request?: unknown) => void;
}

function ImageSequenceImportPanel({
	copy, title, status, statusLine, run,
}: SpecializedPanelProps) {
	const [num, setNum] = useState('24');
	const [den, setDen] = useState('1');
	const submit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		run({ frameRate: frameRateFromInputs(num, den) });
	};
	return <section aria-label={title}>
		{statusLine}
		<form onSubmit={submit}>
			<RationalRateFields {...{ copy, num, den, setNum, setDen }} prefix="image-sequence" />
			<p><button type="submit" disabled={status === 'working'}
				data-framescaper-native-project-action="image-sequence-import"
			>{copy.projectActionRun}</button></p>
		</form>
	</section>;
}

function RenderQueueDeliveryPanel({
	copy, title, status, statusLine, run,
}: SpecializedPanelProps) {
	const [delivery, setDelivery] = useState<'encoded-mov' | 'png' | 'tiff' | 'openexr'
		| 'webm-vp8' | 'webm-vp9' | 'webm-vp9-alpha' | 'webm-av1'>('encoded-mov');
	const [quality, setQuality] = useState<'draft' | 'balanced' | 'high'>('draft');
	const [num, setNum] = useState('24');
	const [den, setDen] = useState('1');
	const [preserveAlpha, setPreserveAlpha] = useState(true);
	const sequence = delivery === 'png' || delivery === 'tiff' || delivery === 'openexr';
	const webm = delivery.startsWith('webm-');
	const submit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		run(sequence ? {
			kind: 'image-sequence', format: delivery,
			frameRate: frameRateFromInputs(num, den), preserveAlpha,
		} : webm ? { kind: 'encoded-webm', codec: delivery.slice(5), quality } : { kind: 'encoded-mov' });
	};
	return <section aria-label={title}>
		{statusLine}
		<form onSubmit={submit}>
			<p><label>{copy.renderDeliveryFormat}<br />
				<select value={delivery}
					data-framescaper-render-delivery="true"
					onChange={(event) => setDelivery(event.currentTarget.value as typeof delivery)}>
					<option value="encoded-mov">{copy.renderDeliveryMov}</option>
					<option value="webm-vp8">{copy.renderDeliveryVp8}</option>
					<option value="webm-vp9">{copy.renderDeliveryVp9}</option>
					<option value="webm-vp9-alpha">{copy.renderDeliveryVp9Alpha}</option>
					<option value="webm-av1">{copy.renderDeliveryAv1}</option>
					<option value="png">{copy.renderDeliveryPng}</option>
					<option value="tiff">{copy.renderDeliveryTiff}</option>
					<option value="openexr">{copy.renderDeliveryOpenExr}</option>
				</select>
			</label></p>
			{webm && <p><label>{copy.renderQuality}<br />
				<select value={quality} onChange={(event) => setQuality(event.currentTarget.value as typeof quality)}>
					<option value="draft">{copy.renderQualityDraft}</option>
					<option value="balanced">{copy.renderQualityBalanced}</option>
					<option value="high">{copy.renderQualityHigh}</option>
				</select>
			</label></p>}
			<fieldset disabled={!sequence}>
				<legend>{copy.renderImageSequenceSettings}</legend>
				<RationalRateFields {...{ copy, num, den, setNum, setDen }} prefix="render" />
				<p><label><input type="checkbox" checked={preserveAlpha}
					onChange={(event) => setPreserveAlpha(event.currentTarget.checked)} />
					{copy.renderPreserveAlpha}</label></p>
			</fieldset>
			<p><button type="submit" disabled={status === 'working'}
				data-framescaper-native-project-action="render-queue-enqueue"
			>{copy.projectActionRun}</button></p>
		</form>
	</section>;
}

function RationalRateFields({
	copy, prefix, num, den, setNum, setDen,
}: Readonly<{
	readonly copy: FramescaperNativeServicesCopy;
	readonly prefix: 'image-sequence' | 'render';
	readonly num: string;
	readonly den: string;
	readonly setNum: (value: string) => void;
	readonly setDen: (value: string) => void;
}>) {
	return <div className="kw-audio-editor-dialog__grid">
		<label>{copy.frameRateNumerator}<br />
			<input type="number" min="1" max="1000000" step="1" required value={num}
				data-framescaper-image-sequence-rate-num={prefix === 'image-sequence' ? 'true' : undefined}
				data-framescaper-render-rate-num={prefix === 'render' ? 'true' : undefined}
				onChange={(event) => setNum(event.currentTarget.value)} />
		</label>
		<label>{copy.frameRateDenominator}<br />
			<input type="number" min="1" max="1000000" step="1" required value={den}
				data-framescaper-image-sequence-rate-den={prefix === 'image-sequence' ? 'true' : undefined}
				data-framescaper-render-rate-den={prefix === 'render' ? 'true' : undefined}
				onChange={(event) => setDen(event.currentTarget.value)} />
		</label>
	</div>;
}

/** User-entered numerator/denominator pairs need not already be in lowest terms. */
function frameRateFromInputs(numerator: string, denominator: string): Readonly<{ num: number; den: number }> {
	const num = Number(numerator), den = Number(denominator);
	if (![num, den].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000)) return { num, den };
	let divisor = num, remainder = den;
	while (remainder !== 0) [divisor, remainder] = [remainder, divisor % remainder];
	return { num: num / divisor, den: den / divisor };
}
