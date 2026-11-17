---
title: "Muunna tallennetut sävelet muokattavaksi MIDIksi"
description: "Analysoi musiikkitallenne Basic Pitchillä ja säilytä muokattavat nuotit äänen rinnalla."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"fi"} -->

Analysoi musiikkitallenne Basic Pitchillä ja säilytä muokattavat nuotit äänen rinnalla.

## Ennen aloitusta

Käytä Soundscaper-työpöytäsovellusta, johon on asennettu julkaistu Basic Pitch -malli ja sitä vastaava runtime. Aloita lyhyestä musiikkivalinnasta, jossa sävelkorkeudet erottuvat selkeästi. Säilytä ääni kuunteluviitteenä.

## Vaiheet

1. Valitse musiikkiääni ja avaa **Työkalut > Laajennettu paikallinen käsittely**.
2. Aseta **Toiminto** **Audio to MIDI (Basic Pitch)**. Vahvista mahdollinen paikallisen käsittelyn suostumus ja valitse **Analysoi**.
3. Valitse **Tarkista tulos**, tarkastele havaittuja nuotteja ja valitse **Hyväksy ehdotus**, kun olet valmis.
4. Avaa **Ikkuna > Piano roll (beta)**, valitse uusi MIDI-materiaali ja korjaa sävelet, ajoitus ja nuottien kestot.

## Tuloksen tarkistaminen

Alkuperäisen äänen rinnalle ilmestyy uusi MIDI-raita. Valitse soitin ja kuuntele sitä yhdessä tallenteen kanssa. **Kumoa** poistaa hyväksytyn ehdotuksen poistamatta lähdeääntä.

## Rajoitukset ja palautus

Tunnistetut nuotit ovat arvioita etenkin tiheissä miksauksissa ja kohinaisissa tallenteissa. MIDI tallentaa nuotit, ei alkuperäistä sointia. Käytä [MIDI-soittimia](/soundscaper/play-midi-instruments/) toistoon ja jaa nuotit valitsemalla **Tiedosto > Muut viennit > Export MIDI (beta)**. Vastaanottajat tarvitsevat edelleen soittimen, jolla haluttu ääni voidaan toistaa.
