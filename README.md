# N.O.V.A. — Neural Operational Virtual Assistant

Three.js tabanlı holografik bir orb arayüzü etrafında kurulmuş, sesle kontrol edilen
kişisel bir AI asistanı. Elle jest kontrolü, yerel LLM (Ollama), tamamen offline
konuşma tanıma, otonom proje üretimi (Claude Code CLI), 3D model üretimi/bulma,
harita ve müzik gibi özellikleri tek bir arayüzde birleştiriyor. Hem tarayıcıda
hem de bağımsız bir Electron masaüstü uygulaması olarak çalışır.

![N.O.V.A.](docs/Ekran%20görüntüsü%202026-08-07%20115301.png)

---

## İçindekiler

- [Özellikler](#özellikler)
- [Kurulum](#kurulum)
- [Ortam değişkenleri (.env.local)](#ortam-değişkenleri-envlocal)
- [Çalıştırma](#çalıştırma)
- [Komutlar](#komutlar)
- [Sesli komutlar](#sesli-komutlar)
- [El jestleri](#el-jestleri)
- [Mimari](#mimari)
- [Sorun giderme](#sorun-giderme)

---

## Özellikler

### Görsel arayüz
- Three.js orb sahnesi: Neural Core, bloom, chromatic aberration, scanline/grain/vignette
- Sürükle-döndür, scroll/pinch ile zoom, momentum + friction ile inertia
- Panel açılışlarında holografik "materialize" animasyonu (proje formu, model tarayıcı, harita)
- Tam ekran başlangıç (F11 ile aç/kapat, Esc ile çık)

### Sesli komut sistemi
- **Web Speech API** birincil motor (tarayıcıda) — Türkçe (`tr-TR`), wake word: **"nova"**
- **Yerel Whisper fallback (Electron)** — `webkitSpeechRecognition` Electron'da
  `network` hatası verir (Chromium'da Chrome'un özel API key'i yok); bu durum otomatik
  algılanıp yerel bir **whisper.cpp sunucusuna** düşülür — tamamen offline, API key gerekmez
  (bkz. [Whisper.cpp kurulumu](#whispercpp-kurulumu-electron-sesli-komut-için))
- Whisper halüsinasyonlarını (`[MÜZİK ÇALIYOR]`, `(Konuşma)`, `"..."` gibi) otomatik filtreler
- Dinlemeye başlarken kısa bir "bing" sesi (Web Audio API, asset gerekmez)
- "vazgeç" evrensel iptal komutu — açık olan her paneli/bekleyen seçimi kapatır

### LLM Beyni (Ollama)
- `/api/llm` proxy route, streaming yanıt — cümle bitince TTS anlık başlar
- Sistem prompt: kimlik (`nova_identity.md`) + öğrenilen dersler (`nova_lessons.md`) + gerekirse web arama context'i
- Konuşma geçmişi kalıcı (`lib/memory.ts`), her turda son 20 mesaj gönderilir
- **"şunu öğren: ..."** / **"bunu not al: ..."** → davranışsal ders olarak kaydedilir
- **"adım X"**, **"tercihimi kaydet: ..."** → yapılandırılmış profile (`nova_profile.json`)
- Ollama offline ise yerel regex/trigger tabanlı komut motoruna düşer

### TTS
- **msedge-tts** (ücretsiz, key gerekmez), ses: `tr-TR-AhmetNeural`
- Pitch/rate/volume ayarlı ("karizmatik" ton), sayılar Türkçe kelimeye çevrilir

### 3D model — bulma ve üretme
- Thingiverse'de arama, sesli **"birinci/ikinci/üçüncü"** ile seçim ve otomatik indirme
- Kameradan nesne tespiti (offline, `@xenova/transformers`) → Meshy API ile 3D model üretimi → STL kaydı
- **"nova, modelleri getir"** → masaüstündeki `models` klasörünü (veya `NOVA_MODELS_DIR`) dialogsuz yükler (Electron)
- Yerelden klasör seçme (tarayıcıda dosya seçici, Electron'da native dialog)

### Otonom proje üretimi
- "yeni proje" komutu/formu → Claude Code CLI'ı arka planda spawn ederek gerçek bir proje yazar
- İki fazlı: önce salt-okunur **plan** (`--permission-mode plan`), onaylanırsa gerçek çalıştırma
- SSE ile canlı log akışı, iş geçmişi, durdurma desteği

### Diğer
- Web arama (Tavily), YouTube video oynatma, harita (OpenStreetMap/Nominatim)
- **YouTube müzik çalma** — küçük widget, ekolayzer animasyonu
- Son dakika haberi isteğinde direkt video açılır (seçenek sorulmaz)

### El jestleri (webcam)
| Jest | Etki |
| --- | --- |
| Tek el pinch (baş+işaret parmak) + sürükle | Orb'u döndür |
| İki el pinch + uzaklaş/yakınlaş | Zoom in/out |
| Üç parmak açık (herhangi bir el) | Müziği duraklat/devam ettir |
| Sağ el yumruk | Önceki şarkı |
| Sol el yumruk | Sonraki şarkı |

---

## Kurulum

```bash
npm install
```

Node.js 20+ ve (isteğe bağlı ama önerilir) [Ollama](https://ollama.com) yerel olarak
kurulu ve çalışıyor olmalı — yoksa LLM özellikleri devre dışı kalır, uygulama basit
komut motoruyla çalışmaya devam eder.

## Ortam değişkenleri (.env.local)

Hiçbiri zorunlu değil — eksik olan servisin özelliği sessizce devre dışı kalır ya da
fallback davranışına döner.

```bash
# LLM (Ollama)
OLLAMA_URL=http://localhost:11434      # varsayılan
OLLAMA_MODEL=llama3.1                  # kullanılacak model adı

# Web arama
TAVILY_API_KEY=

# 3D model üretimi
MESHY_API_KEY=

# YouTube (video + müzik)
YOUTUBE_API_KEY=

# Thingiverse (hazır model arama)
THINGIVERSE_API_KEY=

# Electron + whisper.cpp fallback STT (bkz. Sorun giderme)
WHISPER_SERVER_URL=http://127.0.0.1:8081/inference   # Next.js tarafı proxy hedefi
NOVA_MODELS_DIR=                                       # "modelleri getir" için sabit klasör (varsayılan: Masaüstü\models)
```

`.env.local` `.gitignore`'da — API key'ler asla client'a açılmaz, hepsi server-side proxy route'ları üzerinden geçer.

## Çalıştırma

### Tarayıcıda (geliştirme)
```bash
npm run dev
```
[http://localhost:3000](http://localhost:3000) adresini aç.

### Masaüstü uygulaması (Electron)
```bash
npm run build
npm run electron
```
Gerçek `next start` sunucusunu arka planda başlatıp bir native pencerede açar —
kod tarafında tarayıcı moduyla birebir aynı, hiçbir özellik eksilmez.

Sesli komutun Electron'da çalışması için ayrıca whisper.cpp kurulu olmalı —
bkz. [Whisper.cpp kurulumu](#whispercpp-kurulumu-electron-sesli-komut-için).

### Kalıcı kurulum (installer/exe üretmek)
```bash
npm run electron:dist
```
`release/` klasörüne portable bir `N.O.V.A.exe` üretir. Bu klasör git'e girmez
(`.gitignore`'da) — dağıtım için ayrı bir zip/GitHub Release olarak paylaşılır.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Prod build |
| `npm run start` | Prod server (tarayıcıdan eriş) |
| `npm run electron` | Build'i Electron penceresinde aç |
| `npm run electron:pack` | Build + paketle, sıkıştırılmamış klasöre (`release/win-unpacked`) |
| `npm run electron:dist` | Build + paketle, dağıtılabilir `.exe` üret |

## Sesli komutlar

| Söylenecek | Ne olur |
| --- | --- |
| "nova" | Wake word — sonrasında komut dinler |
| "sus" / "uyu" / "sessiz ol" | Uyku moduna geç |
| "vazgeç" | Açık olan her şeyi iptal et |
| "[şarkı adı] çal" / "müzik aç" | YouTube'dan müzik ara ve çal |
| "müziği durdur/devam ettir/kapat" | Müzik kontrolü |
| "[model adı] modelini bul/indir" | Thingiverse'de ara, "birinci/ikinci/üçüncü" ile seç |
| "nova, modelleri getir" | Sabit klasörden 3D modelleri yükle |
| "sonraki/önceki model" | Yüklenen model listesinde gez |
| "kamerayı aç" | Nesne tara → 3D model üret |
| "yeni proje" | Otonom proje ajanını başlat |
| "[şehir] haritasını göster" | Harita aç |
| "son dakika haberleri" | Direkt haber videosu aç |
| "şunu öğren: ..." | Davranışsal ders olarak kaydet |
| "adım X" | İsmi kaydet |

## El jestleri

Yukarıdaki [Özellikler](#özellikler) tablosuna bakın. Kamera açıkken sağ alttaki
"JESTLER" butonuyla açıp kapatabilirsiniz.

---

## Mimari

```
app/api/                    Next.js API route'ları — tüm dış servisler buradan proxy'lenir
  llm/                       Ollama proxy + status
  stt/                       whisper.cpp proxy (Electron sesli komut fallback'i)
  tts/                       msedge-tts proxy
  services/{search,geocode,thingiverse}/
  project/                   Otonom proje ajanı (plan → onay → çalıştırma)
  detect/ generate3d/        Kameradan 3D model üretimi
  youtube/                   Video + müzik arama

lib/
  useVoice.ts                Ana ses/LLM hook'u — komut motoru, TTS, sohbet akışı
  useAlwaysOn.ts              Arka plan wake-word döngüsü
  speechEngine.ts             Web Speech API ↔ Whisper fallback soyutlaması
  handTracker.ts              MediaPipe el takibi + jest tanıma
  orbScene.ts                  Three.js sahne
  projectAgent.ts              Claude Code CLI spawn/yönetim

electron/
  main.js                    Next.js server + whisper.cpp server'ı başlatan Electron kabuğu
  preload.js                  Native klasör seçici IPC köprüsü
```

Servis proxy deseni: her dış API key'i sadece server-side route'larda okunur,
client'a hiç sızmaz.

---

## Sorun giderme

### Electron'da sesli komut çalışmıyor / "network" hatası

Bu, Electron'un Chromium'unun Chrome'a özel Web Speech API key'ine sahip olmamasından
kaynaklanır — config ile düzeltilemez. Uygulama bunu otomatik algılayıp yerel
**whisper.cpp** sunucusuna geçer. Bunun çalışması için whisper.cpp'nin kurulu ve
çalışıyor olması gerekir:

#### whisper.cpp kurulumu (Electron sesli komut için)

1. [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases) sayfasından
   Windows x64 zip'ini indir (`whisper-bin-x64.zip`), bir klasöre çıkar
   (örn. `C:\whispercpp\bin`)
2. Bir model indir — Türkçe için `small` önerilir (hız/doğruluk dengesi):
   ```
   https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin
   ```
   `C:\whispercpp\models\` altına kaydet
3. `npm run electron` çalıştırıldığında `electron/main.js` bu sunucuyu **otomatik**
   başlatır (yol varsayılanları `C:\whispercpp\...` — farklı bir yerdeyse aşağıdaki
   env değişkenleriyle override et):
   ```bash
   WHISPER_SERVER_EXE=C:\whispercpp\bin\Release\whisper-server.exe
   WHISPER_MODEL_PATH=C:\whispercpp\models\ggml-small-q5_1.bin
   WHISPER_PORT=8081
   WHISPER_THREADS=12
   ```
4. exe/model bulunamazsa uygulama sessizce devam eder ama Electron'da sesli komut
   çalışmaz — konsolda `[whisper] server exe/model not found` uyarısı görülür
   (`NOVA_DEBUG=1 npm run electron` ile DevTools açıp kontrol edebilirsin)

**Hız çok yavaşsa:** `WHISPER_THREADS`'i makinenin çekirdek sayısına yakın bir
değere çıkar; quantize edilmemiş (`ggml-small.bin`) yerine `-q5_1` sürümünü kullan
(zaten varsayılan).

**Yanlış/düşük doğruluk:** `small` yerine `medium` modeline geçmeyi dene — daha
yavaş ama daha isabetli. `WHISPER_MODEL_PATH`'i güncelle yeter.

### electron-builder: `EPERM: operation not permitted, rename ...win-unpacked.tmp`

Windows Defender'ın gerçek zamanlı taraması, yeni çıkarılan `electron.exe`'yi rename
anında kilitliyor. Çözüm — proje klasörü ve electron-builder cache'i için Defender
istisnası ekle (**yönetici olarak** PowerShell'de):
```powershell
Add-MpPreference -ExclusionPath "<proje-klasörü>"
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\electron-builder\Cache"
```

### Kamera veya mikrofon izni Electron'da hiç sormuyor / çalışmıyor

Electron varsayılan olarak `getUserMedia` isteklerini reddeder. `electron/main.js`
içinde `session.setPermissionRequestHandler` ile `media` izni otomatik onaylanıyor
— bu davranışı değiştirmediysen sorun farklı bir yerde olabilir; DevTools console'da
(`NOVA_DEBUG=1`) gerçek hatayı gör (`[scanner] camera start failed: ...` loglanır).

### Dosya seçici / klasör diyaloğu açılmıyor ("File chooser dialog can only be shown with a user activation")

Tarayıcının `<input type="file">.click()`'i, sesle tetiklenen (async) bir akışta
"gerçek kullanıcı jesti" sayılmıyor — bu bir Chromium güvenlik kısıtlaması, kod
hatası değil. Electron'da bunun yerine native `dialog.showOpenDialog` (main process
üzerinden, IPC ile) kullanılıyor; tarayıcı modunda ise sadece butona tıklayarak
(sesle değil) açman gerekiyor.

### Whisper "halüsinasyon" üretiyor (`[MÜZİK ÇALIYOR]`, `(Konuşma)`, `"..."` gibi)

Whisper modellerinin bilinen bir davranışı — ortam sesini/sessizliği konuşma sanıp
uydurma metin üretir. `lib/speechEngine.ts` bu paternleri (köşeli/normal parantez
veya `*...*` ile sarılı satırlar, harfsiz metin) otomatik filtreliyor. Hâlâ
sızıyorsa `SPEECH_RMS_THRESHOLD` değerini yükselterek konuşma algılama eşiğini
sıkılaştırabilirsin (aynı dosyada).

### Terminal/konsol penceresi açılıp duruyor

`electron/main.js`'deki `spawn(...)` çağrılarında `windowsHide: true` zaten
ayarlı — hâlâ görüyorsan whisper.cpp'yi elle (Electron dışında) başlatmış
olabilirsin; `-h` flag'iyle CLI'dan değil, uygulamanın kendisinin başlatmasına izin ver.

### Ollama bağlı değil hatası ilk komutta çıkıyor

Uygulama artık wake-word dinlemeyi Ollama durum kontrolü tamamlanana kadar
aktive etmiyor (`ollamaChecked` gate'i, `lib/useVoice.ts`). Hâlâ oluyorsa Ollama
gerçekten çalışmıyor demektir — `ollama serve` ile başlat.

---

## License

MIT
