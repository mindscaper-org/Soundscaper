# Archived Nyquist browser fixture

`10bandeq.ny.gz` expands to Ten Band E Q by David Sky. Its exact bytes come from the
Audacity Nyquist catalog snapshot at revision
`ed168a19631ec48d0029dfb5c17d16c339a174c1`, published under
`https://assets.soundscaper.org/plugins/nyquist/audacityteam.org/ed168a19631ec48d0029dfb5c17d16c339a174c1/`.
The archive records its SHA-256 as
`e276a06ae0c25fdd68ca5b3f3497cc47a0c7770c6d063cb90fbf86b73cbf91d1`
and its license evidence as `historical-catalog-gpl-version-unspecified`.
The GPL-2.0 and GPL-3.0 texts are preserved alongside this fixture, as in
the source archive. The manifest is stored as a gzip fixture and expands to
the exact 138,341-byte archive manifest whose SHA-256 is
`9b646177cfe178c2d0a03cdda53ae0bbdb7b82f91a1c7594fb7d779e8c45e655`.

These files are used only by the browser test and are not shipped with the app.

`HQ-Tone.ny.gz` expands to the exact 4,908-byte HQ-Tone plug-in by Steve Daulton
from the same archive. Its SHA-256 is
`3ac8c19ff1b27b47346697a4f4347584e185e779291e34eb023a64f815b176b2`.
Its embedded notices state GPL-2.0-or-later; the complete source and notices are
preserved in the compressed fixture, with the GPL texts above. It is also used
by the archive installation regression test.

`Chimesdelay3.ny.gz` preserves Steve Daulton's complete 2,371-byte Chimes Delay
source from the same snapshot, SHA-256
`ecb7e97d021a6f61b4979e8883ef2aadeccb01fff1a19dfcec0b74fd2741e750`.
Its embedded notice grants GPL-2.0-or-later. The archive installation and real
interpreter regression exercises its string note-list control.

`TrimSilence.ny.gz` preserves Steve Daulton's complete 9,577-byte Trim Silence
source, SHA-256
`55910e6008dc8ce20c281073b677f2da7613e9d80533b73f4d754fa7f82e1697`,
with its embedded GPL-2.0 notice. The public controller regression processes
selected PCM through this exact authenticated plug-in.

`ACX-Check.ny.gz` preserves Steve Daulton's complete 4,496-byte ACX Check source,
SHA-256 `baf6580949962a18ed41d1fbed9ed22268c94189db235ca0961655c74d18c52f`,
with its embedded GPL-2.0 notice. The public controller regression runs its
whole-track duration inspection in the real interpreter.

`Pluck-hz.ny.gz` preserves David R. Sky's complete 1,331-byte Pluck (Hz) source,
modified by Steve Daulton, SHA-256
`786dce65f990f1748d351cfe5053a60d889a07782aef58560d6630e6b317ad6b`.
Its GPL-2.0 notice is preserved. The public generator regression checks that
Apply retains the requested duration beyond the plug-in's preview limit.
