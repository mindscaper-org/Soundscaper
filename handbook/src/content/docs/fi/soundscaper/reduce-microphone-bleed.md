---
title: "Vähennä dialogimikrofonien välistä vuotoa"
description: "Luo muokattavia gain-käyriä, jotka vaimentavat korreloitunutta vuotoa passiivisissa mikrofoneissa."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"fi"} -->

Luo muokattavia gain-käyriä, jotka vaimentavat korreloitunutta vuotoa passiivisissa mikrofoneissa.

## Ennen aloitusta

Käytä kahta–kahdeksaa ajallisesti kohdistettua dialogiraitaa, mieluiten yhtä mikrofonia henkilöä kohti ja vertailukelpoisilla tallennusvoimakkuuksilla. Valitse positiivinen aikaväli, jolla jokaisella valitulla raidalla on ääntä. Poista raitojen lukitus ja jäädytys.

## Vaiheet

1. Valitse mikrofoniraidat ja käsiteltävä kohta.
2. Avaa **Tehoste > Kohinanpoisto ja korjaus > Automatic microphone-bleed reduction**.
3. Aloita oletusasetuksilla ja valitse **Create gain envelopes**.
4. Kuuntele kohtaa, erityisesti keskeytyksiä ja päällekkäistä puhetta. Säädä **Klipin vahvistus** luotuja pisteitä, jotka vaimentavat haluttua puhetta.

## Tuloksen tarkistaminen

Gain-pisteet vähentävät vuotoa, mutta alkuperäiset lähteet ja leikkeiden sijainnit pysyvät käytettävissä. Tarkista puhujien alut ja valinta-alueen rajat. **Kumoa** poistaa toiminnon ja **Tee uudelleen** palauttaa sen.

## Rajoitukset ja palautus

Toiminto ei kohdista tallenteita eikä erota aktiivisen mikrofonin sisällä olevia ääniä. Suuret gain-erot, kaiku ja hiljainen puhe voimakkaan vuodon alla voivat aiheuttaa virheitä. Jos kokeilet eri asetuksia, kumoa ensin ensimmäinen käyttö, sillä uusi käyttö lisää vaimennusta. Spektrivalintoja tai lukittuja ja jäädytettyjä raitoja ei voi käsitellä.
