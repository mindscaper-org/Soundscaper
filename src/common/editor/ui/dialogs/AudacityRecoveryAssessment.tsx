/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudacityRecoveryInspection } from '../../audacity-recovery-inspection.ts';
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';

export default function AudacityRecoveryAssessment({ inspection, copy }: Readonly<{
	inspection: AudacityRecoveryInspection; copy: Readonly<Record<string, string>>;
}>) {
	const [page, setPage] = useState(0);
	const start = page * 100;
	const facts = [
		[copy.recoverAudacityIntegrity, inspection.integrity === 'ok' ? copy.recoverAudacityIntegrityPassed : copy.recoverAudacityIntegrityFailed],
		[copy.recoverAudacityActiveDocument, inspection.activeDocument],
		[copy.recoverAudacityTracks, inspection.tracks], [copy.recoverAudacityClips, inspection.clips],
		[copy.recoverAudacityBlocks, inspection.blockRows], [copy.recoverAudacityOrphans, inspection.orphanBlocks],
		[copy.recoverAudacityMissing, inspection.missing.length],
	];
	return <section aria-label={copy.recoverAudacityAssessment}>
		<h3>{copy.recoverAudacityAssessment}</h3>
		<dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
		<p>{inspection.canRepair ? copy.recoverAudacityNativeAvailable : copy.recoverAudacityNativeUnavailable}</p>
		{inspection.missing.length > 0 && <details><summary>{copy.recoverAudacityMissing}</summary>
			<table><thead><tr><th>{copy.recoverAudacityTrack}</th><th>{copy.recoverAudacityClip}</th><th>{copy.recoverAudacityTimeRange}</th></tr></thead>
				<tbody>{inspection.missing.slice(start, start + 100).map((block, index) => <tr key={start + index}><td>{block.track}</td><td>{block.clip}</td><td>{block.startSeconds.toFixed(6)}–{block.endSeconds.toFixed(6)}</td></tr>)}</tbody></table>
			{inspection.missing.length > 100 && <div>
				<Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>{copy.recoverAudacityPreviousRanges}</Button>
				<Button variant="secondary" disabled={start + 100 >= inspection.missing.length} onClick={() => setPage(page + 1)}>{copy.recoverAudacityNextRanges}</Button>
			</div>}
		</details>}
		<details><summary>{copy.recoverAudacityDocuments}</summary><ul>{inspection.documents.map(item => <li key={item.source}>{item.source}: {item.readable ? copy.projectRecoveryUsable : copy.projectRecoveryUnrecoverable} ({item.missingBlocks})</li>)}</ul>
			{inspection.integrity !== 'ok' && <pre>{inspection.integrityMessages.join('\n')}</pre>}
		</details>
	</section>;
}
