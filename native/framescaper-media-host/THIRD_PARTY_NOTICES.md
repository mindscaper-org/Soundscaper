# Framescaper media host third-party notices

The native media host build recipe links against FFmpeg 9.0.1
“Lei”, obtained from `https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz` and
verified against the source digest in `source-manifest.json`. FFmpeg is
available under the GNU Lesser General Public License version 2.1 or later;
configurations that enable GPL components are available under the GNU General
Public License version 2 or later. The pinned build recipe enables the GPL
configuration. FFmpeg copyright and licence texts are included in its source
archive.

The target-native configuration also statically links the manifest-pinned
x264 stable b35605ac (GPL-2.0-or-later), x265 4.2 (GPL-2.0-or-later), libvpx
1.16.0 (BSD-3-Clause), SVT-AV1 4.2.0 (BSD-3-Clause-Clear and the
Alliance for Open Media Patent License 1.0), Opus 1.6 (BSD-3-Clause), and zlib 1.3.1 (Zlib) source
releases. Their complete licence texts and copyright notices are present in
the exact digest-authenticated source archives provisioned by the workflow.

The host uses the manifest-pinned Boost 1.92.0 Multiprecision header closure
under the Boost Software License 1.0. Its licence text is present in the exact
digest-authenticated Boost source archive provisioned by the workflow.

The source template contains no payload bytes until a target result is staged.
The dedicated CI workflow generates target-native payloads with self-tests,
architecture inspection, exact file hashes, this complete notice text, and a
corresponding-source descriptor binding the repository revision and every
upstream archive identity. Packaging accepts only a matching result after the
staging command revalidates it.

## SVT-AV1 4.2.0 license

BSD 3-Clause Clear License
The Clear BSD License

Copyright (c) 2021, Alliance for Open Media

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted (subject to the limitations in the disclaimer below)
provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the distribution.

3. Neither the name of the Alliance for Open Media nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

NO EXPRESS OR IMPLIED LICENSES TO ANY PARTY'S PATENT RIGHTS ARE GRANTED BY THIS LICENSE.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## SVT-AV1 retained BSD 2-clause notices

Copyright (c) 2019, Alliance for Open Media. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the
   distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.


## SVT-AV1 patent license

**Alliance for Open Media Patent License 1.0**

 1. **License Terms.**

    **Patent License.** Subject to the terms and conditions of this License, each
     Licensor, on behalf of itself and successors in interest and assigns,
     grants Licensee a non-sublicensable, perpetual, worldwide, non-exclusive,
     no-charge, royalty-free, irrevocable (except as expressly stated in this
     License) patent license to its Necessary Claims to make, use, sell, offer
     for sale, import or distribute any Implementation.

     **Conditions.**

    *Availability.* As a condition to the grant of rights to Licensee to make,
       sell, offer for sale, import or distribute an Implementation under
       Section 1.1, Licensee must make its Necessary Claims available under
       this License, and must reproduce this License with any Implementation
       as follows:

          a. For distribution in source code, by including this License in the
          root directory of the source code with its Implementation.

          b. For distribution in any other form (including binary, object form,
          and/or hardware description code (e.g., HDL, RTL, Gate Level Netlist,
          GDSII, etc.)), by including this License in the documentation, legal
          notices, and/or other written materials provided with the
          Implementation.

    *Additional Conditions.* This license is directly from Licensor to
       Licensee.  Licensee acknowledges as a condition of benefiting from it
       that no rights from Licensor are received from suppliers, distributors,
       or otherwise in connection with this License.

    **Defensive Termination**. If any Licensee, its Affiliates, or its agents
     initiates patent litigation or files, maintains, or voluntarily
     participates in a lawsuit against another entity or any person asserting
     that any Implementation infringes Necessary Claims, any patent licenses
     granted under this License directly to the Licensee are immediately
     terminated as of the date of the initiation of action unless 1) that suit
     was in response to a corresponding suit regarding an Implementation first
     brought against an initiating entity, or 2) that suit was brought to
     enforce the terms of this License (including intervention in a third-party
     action by a Licensee).

    **Disclaimers.** The Reference Implementation and Specification are provided
     "AS IS" and without warranty. The entire risk as to implementing or
     otherwise using the Reference Implementation or Specification is assumed
     by the implementer and user. Licensor expressly disclaims any warranties
     (express, implied, or otherwise), including implied warranties of
     merchantability, non-infringement, fitness for a particular purpose, or
     title, related to the material. IN NO EVENT WILL LICENSOR BE LIABLE TO
     ANY OTHER PARTY FOR LOST PROFITS OR ANY FORM OF INDIRECT, SPECIAL,
     INCIDENTAL, OR CONSEQUENTIAL DAMAGES OF ANY CHARACTER FROM ANY CAUSES OF
     ACTION OF ANY KIND WITH RESPECT TO THIS LICENSE, WHETHER BASED ON BREACH
     OF CONTRACT, TORT (INCLUDING NEGLIGENCE), OR OTHERWISE, AND WHETHER OR
     NOT THE OTHER PARTRY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

2. **Definitions.**

     **Affiliate.**  "Affiliate" means an entity that directly or indirectly
     Controls, is Controlled by, or is under common Control of that party.

    **Control.** "Control" means direct or indirect control of more than 50% of
     the voting power to elect directors of that corporation, or for any other
     entity, the power to direct management of such entity.

    **Decoder.**  "Decoder" means any decoder that conforms fully with all
     non-optional portions of the Specification.

    **Encoder.**  "Encoder" means any encoder that produces a bitstream that can
     be decoded by a Decoder only to the extent it produces such a bitstream.

    **Final Deliverable.**  "Final Deliverable" means the final version of a
     deliverable approved by the Alliance for Open Media as a Final
     Deliverable.

    **Implementation.**  "Implementation" means any implementation, including the
     Reference Implementation, that is an Encoder and/or a Decoder. An
     Implementation also includes components of an Implementation only to the
     extent they are used as part of an Implementation.

    **License.** "License" means this license.

    **Licensee.** "Licensee" means any person or entity who exercises patent
     rights granted under this License.

    **Licensor.**  "Licensor" means (i) any Licensee that makes, sells, offers
     for sale, imports or distributes any Implementation, or (ii) a person
     or entity that has a licensing obligation to the Implementation as a
     result of its membership and/or participation in the Alliance for Open
     Media working group that developed the Specification.

    **Necessary Claims.**  "Necessary Claims" means all claims of patents or
      patent applications, (a) that currently or at any time in the future,
      are owned or controlled by the Licensor, and (b) (i) would be an
      Essential Claim as defined by the W3C Policy as of February 5, 2004
      (https://www.w3.org/Consortium/Patent-Policy-20040205/#def-essential)
      as if the Specification was a W3C Recommendation; or (ii) are infringed
      by the Reference Implementation.

     **Reference Implementation.** "Reference Implementation" means an Encoder
      and/or Decoder released by the Alliance for Open Media as a Final
      Deliverable.

     **Specification.** "Specification" means the specification designated by
      the Alliance for Open Media as a Final Deliverable for which this
      License was issued.

## SVT-AV1 Safe String Library notices

MIT License

Copyright (c) 2014-2018 Intel Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

================================================================================

Copyright (C) 2012, 2013 Cisco Systems
All rights reserved.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

## SVT-AV1 FAST feature detector notices

Copyright (c) 2006, 2008 Edward Rosten
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:


	*Redistributions of source code must retain the above copyright
	 notice, this list of conditions and the following disclaimer.

	*Redistributions in binary form must reproduce the above copyright
	 notice, this list of conditions and the following disclaimer in the
	 documentation and/or other materials provided with the distribution.

	*Neither the name of the University of Cambridge nor the names of
	 its contributors may be used to endorse or promote products derived
	 from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
