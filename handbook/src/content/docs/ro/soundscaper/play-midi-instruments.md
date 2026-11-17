---
title: "Redă MIDI printr-un instrument"
description: "Alege un sintetizator pentru notele MIDI și păstrează interpretarea editabilă."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"ro"} -->

Alege un sintetizator pentru notele MIDI și păstrează interpretarea editabilă.

## Înainte de a începe

Deschide sau importă MIDI ori creează o pistă nouă în Soundscaper. Opțiunile de redare integrate diferă de instrumentele native opționale. Instrumentele plugin native necesită aplicația desktop și pluginul corespunzător activat.

## Pași

1. Dacă ai nevoie de o pistă, alege **Meniu Piste > Adaugă pistă nouă > MIDI track (beta)**.
2. Deschide **Fereastră > Piano roll (beta)**. Adaugă note sau selectează material MIDI existent.
3. Alege **Instrument**. Pentru un instrument nativ, deschide **Instrument settings** ca să-i reglezi sunetul și să salvezi un preset.
4. Pornește redarea, verifică notele și sustainul, apoi salvează și redeschide proiectul.

## Verifică rezultatul

Ar trebui să auzi instrumentul selectat, în timp ce notele rămân editabile în piano roll. Setările instrumentului și presetările ar trebui să reapară la redeschidere dacă pluginul necesar este instalat.

## Limite și recuperare

Instrumentele native sunt disponibile pe piste MIDI, nu pe piste audio obișnuite. Un preset salvat nu include binarul pluginului sau bibliotecile sale externe. Instrumentele incluse sunt activate implicit în pachetele desktop compatibile; altele pot necesita [Plugin Manager](/soundscaper/use-desktop-plugins/). Verifică redarea și exportul pe computerul de destinație înainte de a te baza pe același timbru.
