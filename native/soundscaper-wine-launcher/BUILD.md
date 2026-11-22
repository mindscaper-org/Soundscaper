# Rebuild the bundled Windows VST3 bridge

The accompanying `corresponding-source.tar.gz` contains the complete yabridge
source, its pinned dependencies and their notices. `SOURCE.json` identifies
the upstream commits and the Soundscaper launcher and build-recipe hashes.
The VST3 SDK in this archive uses its GPL Version 3 license alternative.

On Linux x64, install a C/C++ compiler, Git, Meson, Ninja, pkg-config, Wine
development tools, libxcb development headers and D-Bus development headers.
Ubuntu package names are `build-essential git meson ninja-build pkg-config wine
wine64-tools libwine-dev libxcb1-dev libdbus-1-dev`.

Extract the source archive, enter its `source` directory, then run:

```sh
meson setup build --buildtype=release --cross-file=cross-wine.conf \
  --wrap-mode=forcefallback -Dbitbridge=false -Dclap=false -Dvst3=true -Db_lto=false
meson compile -C build -j 2
cc -std=c17 -O2 -Wall -Wextra -Wpedantic -Werror -fno-ident \
  -Wl,--build-id=none soundscaper-wine-launcher.c -o build/soundscaper-wine-launcher
```

Keep `libyabridge-vst3.so`, `yabridge-host.exe`, `yabridge-host.exe.so` and
`soundscaper-wine-launcher` together. Preserve the executable mode on the host
script and launcher. The archive also contains `soundscaper-build-recipe.mjs`,
the repository packaging recipe; its standalone shell equivalents are above.
Wine remains an external runtime and is not part of this archive.
