# CreatorIQ V1 — AI Clip Finder

En fungerande lokal webbapplikation för att hitta och granska YouTube-klipp med hjälp av tidsatta transkript och gratis AI-modeller via OpenRouter. Valfri analys av samplade videobildrutor kan komplettera rankningen.

## Starta i Windows

Installera **Python 3.12** från python.org. Öppna PowerShell i projektmappen och kör:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m creatoriq
```

Efter första installationen kan du även starta med `start.bat`; den kontrollerar Python-beroendena vid varje start.

Öppna `http://127.0.0.1:8000` i din lokala webbläsare. Servern lyssnar endast på datorns loopback-adress. Ingen Node-byggkedja eller separat databas behövs.

1. Lägg till en **OpenRouter API-nyckel** via API-inställningar.
2. Klistra in en YouTube-adress och beskriv vilka ögonblick du söker.
3. Om undertexter inte kan hämtas: öppna transkriptfältet, ladda upp SRT/VTT eller klistra in tidsatt text och kör igen.
4. Välj analysmetod och en specifik modell under **AI-modell / OpenRouter**. Modellvalet visas direkt i formuläret; text- och bildmodell väljs separat. Standardläget är transkriptanalys och automatiskt modellval.
5. Välj, avvisa eller justera förslagen. Exportera samtliga eller endast valda klipp som JSON.

Gränssnittet är på svenska och fungerar även på mobilbredd. Sparade analyser finns i sidofältet; på mobil används biblioteksknappen i sidhuvudet.

### Valfria videoförutsättningar

**FFmpeg** behövs bara för bildruteanalys. **Node.js LTS** eller Deno rekommenderas för yt-dlp:s JavaScript-utmaningar på YouTube. Med Windows Package Manager kan de installeras med:

```powershell
winget install --id Gyan.FFmpeg --exact
winget install --id OpenJS.NodeJS.LTS --exact
```

Starta om terminalen efter installation så att programmen finns i `PATH`. yt-dlp:s EJS-komponent installeras via Python-beroendena; den hämtas inte godtyckligt under analys. Node aktiveras automatiskt om det finns i PATH; yt-dlp kan också använda Deno som standard.

YouTube kan ändå neka åtkomst från datacenter, för privata/åldersbegränsade videor eller när undertexter saknas. Ingen betalservice eller automatisk cookieinsamling används som reservväg. Manuell SRT/VTT fungerar oberoende av YouTube-åtkomst.

## Felsök YouTube-hämtning i Windows

Öppna PowerShell i mappen med `start.bat`. Kör följande med videons riktiga adress för att se yt-dlp:s fel utan att skriva ut metadata eller använda din OpenRouter-nyckel:

```powershell
.\.venv\Scripts\python.exe -m yt_dlp --ignore-config --no-playlist --skip-download --socket-timeout 20 --retries 0 --extractor-retries 0 --js-runtimes node --print title "https://www.youtube.com/watch?v=VIDEO_ID"
```

Kommandot testar yt-dlp:s vanliga metadata-/formatupptäckt. Appens transkriptflöde använder dessutom `--ignore-no-formats-error`, så undertexter kan hämtas även om inget spelbart videoformat hittas. Bildruteanalysen kräver fortfarande riktiga videoformat. Flaggan löser inte botkontroll, privata videor, nätverksblockering eller saknade undertexter.

Vid JavaScript-varning: installera aktuell Node.js LTS enligt ovan, öppna en ny terminal, kontrollera `node --version` (minst 22) och starta om appen. Att en video fungerar i webbläsaren garanterar inte att YouTube tillåter automatisk hämtning. Ingen inloggning eller cookieimport sker automatiskt.

Appen visar särskilda fel för identifierade proxy-/nätverksfel, botkontroll, åldersgräns, privat video, regionkrav, förfrågningsgräns och JavaScript-/formatproblem. Råa felutskrifter sparas inte i analysresultatet eftersom de kan innehålla signerade adresser eller lokala sökvägar. Okända fel hänvisar till kommandot ovan. Varningen för saknad JavaScript-motor visar programnärvaro, inte verifierad versionskompatibilitet.

## Linux / macOS

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m creatoriq
```

FFmpeg och vid behov Node/Deno installeras med operativsystemets vanliga pakethanterare. För molnmiljön används `CREATORIQ_DATA_DIR=/workspace/VIDEO_PROJ1/.creatoriq` vid start.

## Transkript och tidsnoggrannhet

- yt-dlp prioriterar undertexter på videons originalspråk: först ett matchande manuellt spår, sedan ett markerat automatiskt originalspår (`en-orig` m.fl.) eller annat automatiskt spår på originalspråket. Andra manuella spår och därefter automatiska/översatta alternativ används som reserv. När originalspråket inte framgår prioriteras engelska före svenska bland likvärdiga spår. Ingen video behöver laddas ned för transkriptläget.
- Om ett undertextspår misslyckas provas högst tre olika befintliga spår totalt, med separat temporär katalog för varje försök. Ett misslyckat eller delvis nedladdat spår kan inte återanvändas av nästa försök. Val av reservspår visas i analysens varningar. HTTP 429 på en svensk översättning blockerar därför inte ett fungerande engelskt originalspår.
- SRT/VTT har explicita start- och sluttider med millisekunder. Om tidsatta avsnitt ligger i fel ordning sorteras de efter sina befintliga start- och sluttider med en synlig varning; tiderna ändras inte. Flera avsnitt med samma start och giltiga explicita sluttider tillåts. HTML-markeringar och överlappande ordrepetitioner i automatiska undertexter normaliseras.
- Ren text måste ha en tidsstämpel på varje rad, t.ex. `00:12 En mening.` Varje rad slutar vid nästa tidsstämpel. **Avsluta med en egen tidsrad**, t.ex. `01:30 [END]`, där tiden är den verkliga sluttiden. Rader med lika tidsstämpel slås ihop i ursprunglig textordning. Bakåtgående tider i radformat ger ett fel med radnummer. Om sista raden innehåller tal utan känd sluttid behålls talet som `untimed_tail`: AI:n får det som sammanhang men får inte välja det som klipp. En varning visar att en separat sluttidsmarkör behövs. `[END]` efter tal på samma rad skapar ingen ny sluttid. Otidsatt text avvisas; inga tider hittas på.
- AI:n väljer faktiska `start_cue_id` och `end_cue_id`. Servern validerar ID:n, ordning och längd, och hämtar tider och öppnings-/avslutningsdialog direkt från transkriptet. Modellgenererade tidsstämplar används aldrig.
- Automatisk gränsutvidgning kan ta med upp till fyra avsnitt/20 sekunder extra åt vardera håll för att undvika avbrutna meningar. Avsaknad av tydliga meningsgränser och överlappande slutavsnitt ger en varning.
- Manuell justering sker genom att välja riktiga transkriptavsnitt. Det går inte att spara uppdiktade gränser. AI-poäng och redaktionell motivering beräknas inte om vid justering.
- Noggrannheten begränsas av källans undertexter. Kontrollera alltid klipp mot originalvideon: transkript kan vara felsynkade och en meningsgräns garanterar inte att allt nödvändigt sammanhang finns med.

Långa transkript delas i överlappande delar, **alla delar analyseras**, dubbletter/överlappande förslag filtreras och kandidater rankas globalt. Modellens kontextstorlek styr delstorleken. V1 tillåter högst 1,5 miljoner transkripttecken och 30 000 avsnitt. Varje del kan ge upp till sex kandidater; upp till 40 behålls inför slutrankning. Högst 12 klipp kan begäras. Ett AI-förslag kan vara högst tio minuter långt.

## Gratis modeller och felhantering

Modellistan upptäcks dynamiskt från `GET https://openrouter.ai/api/v1/models`; inga modellnamn är hårdkodade. Endast modeller med textutmatning, tillräcklig kontext och explicit nollpris för prompt, svar och **alla övriga annonserade prisfält** erbjuds. Generativa ljudmodeller och generella routningsalias filtreras bort. Textmodeller med JSON-stöd prioriteras när de finns.

Valda modell-ID:n sparas lokalt i webbläsaren och återställs vid nästa besök. Om en specifikt vald modell försvinner eller inte längre är gratis behålls valet med en varning; analysen stoppas tills du väljer en annan gratis modell eller automatiskt modellval. Även ett tillfälligt fel vid hämtning av katalogen bevarar ditt explicita modellval. Ingen modell ersätts tyst.

Priser och kompatibilitet kontrolleras på nytt **före varje inferensanrop**. Begäran anger samma modell, ingen automatisk provider-reservväg, maxpris noll för in- och utmatning och inga plugins. Betalmodeller avvisas. Om katalogen inte kan kontrolleras stoppas anropet. JSON-format begärs när modellen annonserar stöd för det; svaret valideras alltid.

HTTP 429 och tillfälliga 502/503/504 återförsöks högst två gånger med begränsad väntetid. Övriga API-fel, felaktig JSON, påhittade avsnitt och kontextproblem ger tydliga fel. Inga API-fel leder till betalmodeller. Gratisgränser kan bero på ditt OpenRouter-konto; CreatorIQ köper aldrig krediter eller byter till betalda tjänster.

## Bildruteanalys och jämförelse

Transkriptanalysen slutförs och sparas först. Bildmodulen:

1. Upptäcker en gratis modell med bildinmatning och textutmatning.
2. Hämtar två korta videosektioner per kandidat från högst sex av de högst bedömda transkriptkandidaterna. Varje begärd sektion är 1,5 sekunder och begränsas till 40 MB utdata via FFmpeg (samt yt-dlp:s storlekskontroll när den stöds).
3. Extraherar en JPEG-bild ur varje sektion med FFmpeg, högst 640 pixlar bred.
4. Låter bildmodellen beskriva synliga handlingar, reaktioner och relevant kontext i de samplade stillbilderna.
5. Rankar om transkriptkandidaterna med dessa observationer. Visuella observationer och begärda källpositioner följer med resultaten; själva bildfilerna och videosektionerna raderas från temporärlagringen.

Detta är **samplad stillbildsanalys**, inte kontinuerlig eller genuint temporal videoförståelse. Begärda bildpositioner är ungefärliga eftersom videons sökning/nyckelrutor påverkar dem. Rörelser, händelseförlopp och osedda scenbyten kan inte fastställas från dessa bilder. Bildmodulen hittar inte händelser utanför de redan transkriptbaserade kandidaterna. Kandidater utan observation bedöms från transkriptet. Poäng och redaktionella motiveringar kommer från transkriptanalysen; visuell information påverkar den separata rankningen.

I läget **Jämför båda metoderna** visas båda listorna sida vid sida och i separata granskningsflikar. Val/avvisning och justering sparas separat per metod. När ett visuellt klipps gränser justeras tas dess aktiva bildkontext bort och en varning visar att den nya perioden inte analyserats. Originalobservationerna finns kvar som proveniens i exporten.

Om gratis bildmodell, FFmpeg eller videoåtkomst saknas behålls transkriptresultatet med en synlig förklaring. Du kan alltid köra transkriptläge separat.

## API-nycklar och lokala data

- På Windows används Credential Manager via `keyring` om säker lagring väljs. macOS Keychain och Linux Secret Service stöds när tillgängliga. Okända och klartextbaserade backends tillåts inte.
- Sessionslagring finns alltid: nyckeln hålls bara i serverprocessens minne och försvinner vid omstart.
- `OPENROUTER_API_KEY` kan alternativt sättas i processmiljön. Den skrivs aldrig ut. En miljönyckel tas bort genom att ta bort miljövariabeln och starta om servern.
- Nyckeln returneras aldrig till klienten och lagras inte i Git, SQLite, webbläsarens lagring eller JSON-export. Webbläsaren skickar den till den lokala servern när du sparar den och tömmer sedan fältet.
- SQLite sparas i `~/.creatoriq/creatoriq.sqlite3` som standard. `CREATORIQ_DATA_DIR` väljer en annan katalog. Säkerhetskopiera databasen för att behålla analyser.
- Transkript och utvalda bildrutor **skickas till OpenRouter/modellleverantören** vid analys. Själva resultatlagringen är lokal. Använd innehåll som du får behandla och dela med leverantören.
- Servern har Host-kontroll, ingen CORS-öppning och CSRF-token på skrivande anrop. Exponera den inte som publik server; V1 har ingen fleranvändarinloggning. Nycklar och analyser delas av den lokala serverprocessens användare.

Historiken visar de senaste 100 analyserna. Databasen behåller även äldre resultat. Upp till två analysjobb kan köras samtidigt. Resultat sparas över omstart; avbrutna jobb markeras som avbrutna och startas inte automatiskt på nytt.

## Arkitektur

```text
creatoriq/
  app.py          Lokal HTTP-API, uppladdning, bakgrundsjobb, export
  models.py       Validerade datamodeller och feltyper
  transcripts.py  YouTube-provider och SRT/VTT/tidsatt text
  analysis.py     Delanalys, ID-validering, gränser och rankning
  openrouter.py   Modellupptäckt, gratisfilter och API-klient
  vision.py       Separat FFmpeg-sampler och bildanalysmodul
  service.py      Orkestrering och granskning av klipp
  storage.py      SQLite-persistens
  credentials.py  OS-nyckelhanterare och sessionsnycklar
  static/         HTML, CSS, JavaScript och exempeltranskript
```

Transkript-provider, modellklient, bildsampler och bildanalysmodul injiceras i tjänsten/app-fabriken. De kan ersättas utan att skriva om gränssnittet eller tidsvalideringen. Exporten har `schema_version: 1` med ursprungstranskript, begäran, metod, modell, klipp, användarstatus och eventuell visuell proveniens.

V1 renderar eller klipper inte videofiler. Automatisk redigering, captions, speaker tracking, analys av YouTube-kanaler och AI-redigeringsagenter är inte implementerade.

## Tester

Windows:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Linux/macOS:

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

Tester använder fixtures och mockade OpenRouter/YouTube-svar; inga riktiga nycklar eller API-kostnader behövs. FFmpeg-testet extraherar riktiga JPEG-bilder från en lokalt genererad testvideo; detta test hoppas över om FFmpeg saknas. `tests/serve_fixture.py` är en uttryckligen separat fixture-server för webbläsartestning, aldrig produktens startpunkt.

### Verifierat i utvecklingsmiljön

- 79 pytest-tester passerade, inga hoppades över; riktig FFmpeg-extraktion ingick.
- Chromium: uppladdning, analys, båda metoderna, val/avvisning, tidsjustering, JSON-nedladdning, beständig historik efter sidomladdning och mobilbibliotek kontrollerades med fixtures. Inga JavaScript-fel eller horisontellt överflöde på mobil hittades. Separata modellval för text/bild, återställning efter omladdning, stopp vid borttagen modell och faktiska modell-ID:n i analysbegäran verifierades också med fixtures.
- Det rapporterade transkriptet med dubbla `1:29` och en avslutande rad med både tal och `[END]` verifierades lokalt i Chromium mot fixture-API: hela dialogen bevaras, lika tider slås ihop, slutdialog utan sluttid används enbart som sammanhang och inga sluttider gissas.
- OpenRouters riktiga modellkatalog kunde hämtas och gratis-/modalitetsfiltret kördes mot den.
- **Återstår live:** inferens med en riktig OpenRouter-nyckel, YouTube-undertexter och nedladdning av YouTube-videosektioner. YouTube-åtkomst nekades av molnproxyn (403). Ingen riktig API-nyckel fanns. Bildinferens och YouTube-flödet är därför fixtureverifierade, inte verifierade mot riktiga videor här.
- Windows-kommandon och nyckelhantering är implementerade för Windows men har inte körts på en Windows-maskin i denna Linuxmiljö.

Miljöutkastet för molnkörning innehåller nätverksdomäner för OpenRouter och YouTube. Spara/granska och publicera miljön i miljöinställningarna för att aktivera den återanvändbara konfigurationen. Ett sparat utkast är inte bevis för att en ny miljö publicerats eller fungerar med alla nätverksdestinationer.
