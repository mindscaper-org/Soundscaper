/* SPDX-License-Identifier: AGPL-3.0-only */
import { soundcraftSession } from './native-daw-import-fixtures.ts';

export function soundcraftInputTrimSession(preFader: boolean, automated = false) {
	const fixture = soundcraftSession(), trimDb = 20 * Math.log10(.5);
	return { ...fixture, busses: [{ id: 80, name: 'Cue input', format: 'Stereo' }], tracks: [
		...fixture.tracks.map(track => ({ ...track, playlists: track.playlists.map(playlist => ({ ...playlist,
			clips: playlist.clips.map(clip => ({ ...clip, gain_db: 0, gain_env: [], fade_in: { len: 0, shape: 'Linear' }, fade_out: { len: 0, shape: 'Linear' } })),
		})), mixer: { volume_db: 0, trim_db: trimDb, pan: [0], mute: false, solo: false, output: 'None', automation_mode: 'Read',
			sends: [{ target: { Bus: 80 }, level_db: 0, pan: 0, mute: false, pre_fader: preFader }] },
			automation: automated ? [{ param: { SendLevel: 0 }, enabled: true, points: [{ at: 0, value: 0 }, { at: 48000, value: 0 }] }] : [],
		})),
		{ id: 30, name: 'Cue return', kind: 'Aux', format: 'Stereo', playlists: [], mixer: { volume_db: 0, trim_db: 0, pan: [-1, 1], mute: false, solo: false,
			input: { Bus: 80 }, output: 'Main' } },
	] };
}
