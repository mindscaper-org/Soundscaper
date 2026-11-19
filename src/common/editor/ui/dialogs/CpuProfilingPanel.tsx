/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { startCpuProfiling } from '../../controller/transport/cpu-profiling.ts';
import { cpuProfileEffectRows, type CpuProfileProject } from '../../cpu-profile-rows.ts';
import type { CpuProfilerBridge, CpuProfileReading } from '../../cpu-profile-contract.ts';
import { audioEffectLabel } from '../../effects.js';
import type { EngineEffect } from '../../engine/types.ts';
import './cpu-profiling-panel.css';

export default function CpuProfilingPanel({ bridge, project, copy, locale, onClose }: {
	readonly bridge: CpuProfilerBridge;
	readonly project: CpuProfileProject | null;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale: string;
	readonly onClose: () => void;
}) {
	const [reading, setReading] = useState<CpuProfileReading | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => startCpuProfiling({ bridge, publish: setReading,
		onError: value => setError(value instanceof Error ? value.message : copy.cpuProfilingFailed),
		schedule: (callback, delay) => setTimeout(callback, delay), clear: timer => clearTimeout(timer),
	}), [bridge, copy.cpuProfilingFailed]);
	const rows = cpuProfileEffectRows(project, reading?.effects ?? []);
	const percent = (value: number | null | undefined) => value == null ? '—'
		: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value / 100);
	return <AudioEditorDialogShell isOpen modal={false} title={copy.cpuProfiling} onClose={onClose}
		width={660} dataAttributes={{ 'data-cpu-profiling': true }}>
		<div className="kw-cpu-profiling">
			<p>{copy.cpuProfilingDescription}</p>
			<p>{copy.cpuProfilingRestart}</p>
			{error && <p role="alert">{error}</p>}
			<table>
				<thead><tr><th scope="col">{copy.cpuProfilingComponent}</th><th scope="col">{copy.cpuProfilingCpu}</th><th scope="col">{copy.cpuProfilingElapsed}</th></tr></thead>
				<tbody>
					<tr><th scope="row">{copy.cpuProfilingEditor}</th><td>{percent(reading?.editorCpuPercent)}</td><td>—</td></tr>
					{rows.map(row => <tr key={row.key}>
						<th scope="row">{row.scope === 'master' ? copy.master : row.ownerName} · {copy.cpuProfilingEffectPosition
							.replace('{effect}', effectName(row.effect, copy)).replace('{position}', String(row.position))}
							{row.native && <small>{copy.cpuProfilingNative}</small>}
						</th>
						{row.disabled ? <td colSpan={2}>{copy.cpuProfilingBypassed}</td> : <>
							<td>{percent(row.reading?.cpuPercent)}</td><td>{percent(row.reading?.elapsedPercent)}</td>
						</>}
					</tr>)}
				</tbody>
			</table>
			{!rows.length && <p>{copy.cpuProfilingEmpty}</p>}
			<p>{copy.cpuProfilingNotes}</p>
		</div>
	</AudioEditorDialogShell>;
}

function effectName(effect: EngineEffect, copy: Readonly<Record<string, string>>): string {
	const name = effect.params?.pluginName;
	if (effect.type === 'native-plugin' && typeof name === 'string') return name;
	try { return audioEffectLabel(effect.type ?? '', copy); }
	catch { return effect.type ?? ''; }
}
