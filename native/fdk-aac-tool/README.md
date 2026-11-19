# Third-Party Modified Version of the Fraunhofer FDK AAC Codec Library for Android

This executable runs independently from Soundscaper and takes ordinary float32
little-endian PCM or ADTS files. Run it without arguments for the command syntax.

The complete FDK AAC sources are in `fdk-aac-free-2.0.3.tar.gz`. They are the
same sources as Fedora's stripped 2.0.3 package. The accompanying `NOTICE`
contains the Fraunhofer software license and `LICENSE` covers the separate
command-line frontend.

On November 19, 2026, Soundscaper added the standalone frontend and changed
the fork's decoder to refuse in-band spectral band replication. The change
keeps the AAC-LC decoder from returning only the low-frequency core of an
HE-AAC file. The command-line encoder emits AAC-LC and the decoder admits LC
framing. See the exact decoder change in `reject-sbr.cmake`.

Extract the source archive, then configure and build the frontend in this
directory with CMake and a target-native C++ compiler:

```sh
cmake -S . -B build -DFDK_AAC_SOURCE=/absolute/path/to/fdk-aac-2.0.3
cmake --build build --config Release
```

CMake copies and patches the decoder translation unit in its build directory.
It leaves the extracted sources intact.
