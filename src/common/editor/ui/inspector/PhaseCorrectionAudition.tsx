/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { useComponentCopy } from '@soundscaper/design-system/contexts/ComponentCopyContext';
import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';
import { formatLocalizedTemplate } from '../localization-template.ts';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { LabeledDropdown } from './inspector-controls.jsx';
import type { PhaseCorrectionAuditionOptions, PhaseCorrectionPreviewReport } from '../../first-party-effects/phase-correction/preview-contract.ts';

interface Props {
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly options: PhaseCorrectionAuditionOptions;
	readonly reports: readonly PhaseCorrectionPreviewReport[] | null;
	readonly onChange: (options: PhaseCorrectionAuditionOptions) => void;
	readonly onAnalyze: () => void;
}

/** Audition settings affect temporary playback only, never the applied PCM or presets. */
export default function PhaseCorrectionAudition({ copy, disabled, options, reports, onChange, onAnalyze }: Props) {
	const { locale } = useComponentCopy();
	const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
	const text = (key: string): string => canonicalCopyValue(key, copy);
	return <section aria-label={text('effectPhaseCorrectionAudition')}>
		<p className="audio-editor-panel-hint">{text('effectPhaseCorrectionHint')}</p>
		<div className="audio-editor-audacity-layout__parameters">
			<Button variant="secondary" disabled={disabled} onClick={onAnalyze}>{text('effectPhaseCorrectionAnalyze')}</Button>
			<LabeledDropdown label={text('effectPhaseCorrectionPreviewSource')} value={options.source} disabled={disabled} hook="phase-correction-preview-source"
				options={(['corrected', 'original'] as const).map(source => ({ value: source,
					label: text(source === 'original' ? 'effectPhaseCorrectionOriginal' : 'effectPhaseCorrectionCorrected') }))}
				onChange={(source: string) => onChange({ ...options, source: source === 'original' ? 'original' : 'corrected' })} />
			<PreferenceCheckbox label={text('effectPhaseCorrectionMono')} checked={options.mono} disabled={disabled}
				onChange={mono => onChange({ ...options, mono })} />
		</div>
		{reports && <div role="status" aria-label={text('effectPhaseCorrectionResults')}>
			{reports.map((report, index) => {
				const { analysis, sampleRate, trackName } = report;
				const message = analysis.status === 'uncertain' ? text('effectPhaseCorrectionUncertain')
					: analysis.status === 'aligned' ? text('effectPhaseCorrectionAligned')
						: formatLocalizedTemplate(text(analysis.lagSamples >= 0 ? 'effectPhaseCorrectionRightLate' : 'effectPhaseCorrectionLeftLate'), {
							samples: number.format(Math.abs(analysis.lagSamples)),
							milliseconds: number.format(Math.abs(analysis.lagSamples) / sampleRate * 1000),
							confidence: number.format(analysis.confidence * 100),
						});
				return <p key={index}><strong>{trackName}: </strong>{message}</p>;
			})}
		</div>}
	</section>;
}
