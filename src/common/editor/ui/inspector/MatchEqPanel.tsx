/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';
import type { MatchEqProfile } from '../../first-party-effects/match-eq/definition.ts';
import type { MatchEqPreviewReport } from '../../first-party-effects/match-eq/preview-contract.ts';
import { LabeledDropdown } from './inspector-controls.jsx';
import MatchEqGraph from './MatchEqGraph.tsx';

export default function MatchEqPanel({ copy, disabled, reference, reports, source, onSource, onLearn, onAnalyze, onEdit }: Readonly<{
	copy: Readonly<Record<string, string>>;
	disabled: boolean;
	reference: MatchEqProfile | null;
	reports: readonly MatchEqPreviewReport[] | null;
	source: 'original' | 'corrected';
	onSource: (source: 'original' | 'corrected') => void;
	onLearn: () => void;
	onAnalyze: () => void;
	onEdit: () => void;
}>) {
	const text = (key: string): string => canonicalCopyValue(key, copy);
	return <section aria-label={text('effectMatchEqPanel')}>
		<p className="audio-editor-panel-hint">{text('effectMatchEqHint')}</p>
		<p role="status">{text(reference ? 'effectMatchEqReferenceReady' : 'effectMatchEqReferenceMissing')}</p>
		<div className="audio-editor-panel-actions">
			<Button variant="secondary" disabled={disabled} onClick={onLearn}>{text('effectMatchEqLearn')}</Button>
			<Button variant="secondary" disabled={disabled || !reference} onClick={onAnalyze}>{text('effectMatchEqAnalyze')}</Button>
			<Button variant="secondary" disabled={disabled || reports?.length !== 1 || !reports[0]?.analysis.curve.length} onClick={onEdit}>{text('effectMatchEqEditCurve')}</Button>
		</div>
		<LabeledDropdown label={text('effectMatchEqPreviewSource')} value={source} disabled={disabled} hook="match-eq-preview-source"
			options={(['corrected', 'original'] as const).map(value => ({ value, label: text(value === 'original' ? 'effectMatchEqOriginal' : 'effectMatchEqCorrected') }))}
			onChange={(value: string) => onSource(value === 'original' ? 'original' : 'corrected')} />
		<MatchEqGraph copy={copy} reference={reference} reports={reports} />
		<p className="audio-editor-panel-hint">{text('effectMatchEqCurveHint')}</p>
		<p className="audio-editor-panel-hint">{text('effectMatchEqLimitations')}</p>
	</section>;
}
