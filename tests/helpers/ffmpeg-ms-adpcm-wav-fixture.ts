/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzlibSync } from 'fflate';

// Untouched FFmpeg 6.1.1 stereo MS ADPCM output for 6,077 authored frames.
const WAVE = 'eNrtl79Kw1AUxr9bA3UydrJI4eYJSurQUepgIFAUbGnnoGRzEIKrWSS+kwg+gKvPYQIObtdzblKvFAfpYiXn93H+JRBCOCfJuYijKBsAy5PFaXqdBUcAOqT8EciPqfA8BHjf6QLKnjLk8YwJSoovKjQPqm/S5DLzqH46AKbxbH5IeXwWncezaL5H+TS5TcfhcDQejsIQV0mWYMDX2Sch0G/WBEFoFTL/v6Vr6awf9lUtTtD4VU25IGz//NPPBJsgbEzOlD90WOnEBb5F0d+qnv/FKyZs0sOC0L7vv8y/IMj8b89d7TLN8tzs13a5duZ/rdpu5W6n7m5YmvNKK6M0+95aXFV1XekWPy+RU7P/9/FhDSiK4r507wbqFmXQ8yvfmiFv28fmIpHoX+sTWPw2bQ==';
const DECODED = 'eNrt1EtIVFEcx/F/VHh9ZWnzcCb0ShRk0aYHieBccVP00ITuSiSoaBPYSqhAJguiRdMyQmnRVrCdy1wIQjGBUneiFy6kqMScmmbOmYROPzkDEREFRUTzW3z4/s//Hi53dcVtXhIiIiIiIiIiIiKiX3IdbmbFDefErSmK21sh7pVt4irv94US4k6jnegt9BQ6hA6jJz1rHPNRdDJh7fasDOZWdC5hxTG/QkPoArres3KYa9ECWoUWE0REREREf494REREROUk2Yw2oY1oDTovXs+jP+dARrzLaAwdR/OBeDPoY3QBnURXwRg0lFwDFy6W7IJz0F5yBjw4XbIfTsBBOA5HoJ9lWZYtq/pERERERERERERERERERERE9I9JJtAOtA3dga72g56PP3Zh2Q+q837w8JMf3EYPoZsKfjBX9IOhgrWvaK1V1n1t9SvrkrZuKOsY5jG0S1v3MO9FA2VtxvwCjWvrLeYwuqSsdZhzaDVaQB1Usyz7n3Uanck4+vATrbrmHH11Uau7dY4ejGs1GP+2IxsdPRXTairm6HRIq3TI0Q8atdoTdvQAOtDoaPxG1Ha0PqJVfQT3o1p1oCPoSNTRw9gPoaPoKPa92N9BO9FO7NPYp3FuxTmDtqAt2L/EPoYuoCE0i2bxvBbPc2gVWkAr0Iooy7Isy7Ls10pUvpOMnNUSPl9MblDLsqZNsp9/7rlY3WbWdJudkpJnJiVbJGXmzYo+vLhP3pgJ0yAT5p1plzpplw+4XSOzJm+2SqU8Ndo0iSNNos1r46x8illEG9D3aB2aR/O4V4l7GnVYlmVZlmVZlmVZtgz7Bbhok1M=';

function inflate(value: string): Uint8Array<ArrayBuffer> {
	return unzlibSync(Uint8Array.from(atob(value), character => character.charCodeAt(0)));
}

export function ffmpegMsAdpcmWavFixture() {
	const file = new File([inflate(WAVE)], 'Recorded in FFmpeg.wav', { type: 'audio/wav' });
	const pcm = inflate(DECODED);
	const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	const decodedFrames = pcm.byteLength / 4;
	const channels = [0, 1].map(channel => Float32Array.from({ length: decodedFrames },
		(_, frame) => view.getInt16((frame * 2 + channel) * 2, true) / 32768));
	return { file, channels, decodedFrames, frameCount: 6077, sampleRate: 48_000 };
}
