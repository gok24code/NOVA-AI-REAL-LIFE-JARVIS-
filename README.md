# N.O.V.A. — Neural Operational Virtual Assistant

Three.js tabanlı holografik bir orb arayüzü etrafında kurulmuş, sesle kontrol edilen
kişisel bir AI asistanı. Elle jest kontrolü, yerel LLM (Ollama), tamamen offline
konuşma tanıma, otonom proje üretimi (Claude Code CLI), 3D model üretimi/bulma/düzenleme,
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

**Son Güncellemeler:**
- **Model Tasarım Modu (Edit Mode)** 🧩: Yüklenen 3D modelleri holografik bir çalışma
  alanında seçip taşıyarak parçaları görsel olarak "montaj" haline getirme — bkz.
  [3D model — düzenleme ve montaj](#3d-model--düzenleme-ve-montaj-edit-mode)
- **Sahneyi anlatma**: "ne görüyorsun" / "ortamı anlat" — kameradan tespit edilen
  nesneleri Türkçe cümleyle özetliyor
- **Intelligent Barge-In** 🎤: Nova konuşurken sesli kesme — Ollama embedding ile bağlamı koruyup doğal yanıt veriyor
- **Self-Update** 📚: "şunu öğren" komutuyla kendi kendini uyarlayan bellek sistemi
- **Kullanıcı Profili** 👤: İsim ve tercihler otomatik kaydediliyor, her cevap bağlamına uyuyor
- **Plan → Onay → Çalıştırma** ✅: Proje üretiminde iki aşamalı güvenlik (salt-okunur plan sonra insan onayı)

### Görsel arayüz
- Three.js orb sahnesi: Neural Core, bloom, chromatic aberration, scanline/grain/vignette
- Sürükle-döndür, scroll/pinch ile zoom, momentum + friction ile inertia
- Panel açılışlarında holografik "materialize" animasyonu (proje formu, model tarayıcı, harita, edit mode)
- Tam ekran başlangıç (F11 ile aç/kapat, Esc ile çık — Esc ayrıca Edit Mode'dan da çıkar)

### Sesli komut sistemi
- **Web Speech API** birincil motor (tarayıcıda) — Türkçe (`tr-TR`), wake word: **"nova"**
- **Yerel Whisper fallback (Electron)** — `webkitSpeechRecognition` Electron'da
  `network` hatası verir (Chromium'da Chrome'un özel API key'i yok); bu durum otomatik
  algılanıp yerel bir **whisper.cpp sunucusuna** düşülür — tamamen offline, API key gerekmez
  (bkz. [Whisper.cpp kurulumu](#whispercpp-kurulumu-electron-sesli-komut-için))
- Whisper halüsinasyonlarını (`[MÜZİK ÇALIYOR]`, `(Konuşma)`, `"..."` gibi) otomatik filtreler
- Dinlemeye başlarken kısa bir "bing" sesi (`lib/chime.ts`, Web Audio API ile sentezlenir, asset gerekmez)
- **Intelligent Barge-in**: Nova konuşurken bile sesli kesme desteği — Ollama embedding ile 
  konu sürekliliğini analiz edip konuşmaya doğal biçimde bağlantı kuruyor
- "vazgeç" evrensel iptal komutu — açık olan her paneli/bekleyen seçimi kapatır
- **Uyku modu komutları**: "sus" / "uyu" / "sessiz ol" / "bekleme moduna geç" / "kapat" / "görüşürüz nova" / "bay bay nova"
- Basit yardımcı komutlar (LLM veya internet gerektirmez): saat/tarih sorma, zoom in/out/reset

### LLM Beyni (Ollama)
- `/api/llm` proxy route, streaming yanıt — **cümle bitince otomatik TTS başlar**
- Sistem prompt: kimlik (`nova_identity.md`) + öğrenilen dersler (`nova_lessons.md`) + gerekirse web arama context'i
- Konuşma geçmişi kalıcı (`lib/memory.ts`), her turda son 20 mesaj gönderilir
- Yukarıdaki sabit komutların hiçbirine uymayan ama haber/fiyat/döviz/hava durumu/kimdir/
  nedir/tarif/maç/deprem gibi geniş bir anahtar kelime setiyle eşleşen istekler otomatik
  olarak Tavily web aramasıyla zenginleştirilip LLM'e context olarak veriliyor
- **Self-Update (Öğrenilen Notlar)**:
  - `"şunu öğren: ..."` / `"bunu not al: ..."` / `"bunu hatırla: ..."` → davranışsal ders olarak `nova_lessons.md`'ye kaydediliyor
  - Uykuya giderken arka planda otomatik ders çıkarım (sohbetten anlamlı dersleri filtreler)
- **Kullanıcı Profili**:
  - `"adım X"` / `"ismim X"` / `"beni X olarak çağır/adlandır/hatırla"` → kullanıcı adı kaydediliyor
  - `"tercihimi kaydet: ..."` / `"bunu tercih olarak kaydet: ..."` → tercih listesine ekleniyor (max 40)
  - Profil her LLM çağrısında sistem promptuna otomatik dahil ediliyor
- Ollama offline ise yerel regex/trigger tabanlı komut motoruna düşer

### TTS
- **msedge-tts** (ücretsiz, key gerekmez), ses: `tr-TR-AhmetNeural`
- Pitch/rate/volume ayarlı ("karizmatik" ton), sayılar Türkçe kelimeye çevrilir

### 3D model — bulma ve üretme
- Thingiverse'de arama (`"[X] modelini/kılıfını/parçasını bul/indir/ara"`), sesli
  **"birinci/ikinci/üçüncü"** ile seçim ve otomatik indirme
- Belirli bir modeli adıyla yükleme: **"[X] modelini yükle/göster/aç"** — Thingiverse
  aramasından ayrı, yerel kütüphanede doğrudan isimle model açan farklı bir komut yolu
- Kameradan nesne tespiti (offline, `@xenova/transformers` DETR-ResNet-50, `/api/detect`)
  → Meshy API ile 3D model üretimi → STL kaydı
- **Sahneyi anlatma**: kamera açıkken **"ne görüyorsun" / "ne var orada" / "etrafı anlat" /
  "ortamı anlat"** dendiğinde aynı DETR modeli düşük eşikli bir `describe` modunda
  çalışıp gördüğü nesneleri ("Sahnede sandalye, masa ve laptop görüyorum." gibi) Türkçe
  bir cümleyle özetliyor ve sesli okuyor
- **"nova, modelleri getir"** → masaüstündeki `models` klasörünü (veya `NOVA_MODELS_DIR`)
  dialogsuz yükler (Electron) — Meshy'nin ürettiği STL'ler de **aynı klasöre** kaydedilir,
  yani manuel yerleştirilen ve otomatik üretilen modeller tek bir yerel kütüphanede birleşiyor
- Yerelden klasör seçme (tarayıcıda dosya seçici, Electron'da native dialog)
- "sonraki/önceki model" ile yüklenen model listesinde gezinme, "modeli kaldır/kapat/temizle" ile sahneden çıkarma

### 3D model — düzenleme ve montaj (Edit Mode)
Birden fazla ayrı model dosyasını (ör. çok parçalı bir baskı, taranmış farklı nesneler)
görsel olarak birbirine göre konumlandırıp tek bir "montaj" olarak birleştirmeyi sağlayan,
tamamen jest/mouse tabanlı bir çalışma modu.

- **Açma:** Sağ alttaki HUD'da "JESTLER" butonunun yanındaki **EDIT MODE** butonuna tıkla
  (sesli komutla açılmıyor — bilinçli bir tasarım tercihi, bkz. `components/JarvisOrb.tsx`).
  `Esc` veya butona tekrar tıklamak modu kapatır.
- **Ön koşul:** Edit Mode'a girmeden önce en az bir model yüklenmiş olmalı (Thingiverse,
  kamera taraması veya "modelleri getir" ile).
- Açılınca tüm yüklü modeller, ayrı ve şeffaf arka planlı bir Three.js sahnesinde
  (`lib/editScene.ts`) camgöbeği renkli (`#06b6d4`) holografik tel kafes + yarı saydam
  gövde olarak, merkezdeki görünmez bir "montaj küresi" etrafında dairesel olarak
  otomatik diziliyor (`arrangeRadial`).
- **Seçim:** Bir modele tıklamak (mouse veya el pinch-başlangıcı ile raycast) onu seçili
  hale getirir ve rengini amber'a (`#fbbf24`) çevirir; merkezdeki küreye tıklamak ise onu
  "tüm montajı birlikte döndürme" kolu olarak seçer.
- **Hareket ettirme** (tamamen el jesti veya mouse ile — bkz. [El jestleri](#el-jestleri)):
  serbest el hareketi seçimi döndürür, tek el pinch + hareket sürükler, iki el pinch
  zoom yapar, üç parmak açık küçük bir eğim darbesi verir. Mouse ile sürüklemek de aynı
  şekilde çalışır (tarayıcı/Electron fark etmez).
- **TransformPanel** (üst sağ, en az bir model seçiliyken görünür): **ODAKLAN** kamerayı
  seçime kilitler, **SİL** seçili model(ler)i sahneden kaldırır.
- **EditModeUI** (üst sol): toplam model sayısı, seçili sayısı, üzerine gelinen modelin adı
  ve jest ipuçları burada gösterilir.
- **Montaj tespiti:** Bir modeli sürükleyip merkezdeki küreye yeterince yaklaştırmak onu
  otomatik olarak "montajlanmış" işaretler ve yeşile (`#22c55e`) boyar.
- **Çıkış:** Edit Mode kapatıldığında (buton veya Esc), o an "montajlanmış" işaretli tüm
  parçaların geometrisi + konumu + rotasyonu alınıp ana orb sahnesine tek, birleşik,
  çok parçalı bir holografik obje olarak yükleniyor (`loadAssembly`) — yani Edit Mode'da
  görsel olarak bir araya getirdiğin parçaları ana ekranda tek bir "monte edilmiş" nesne
  gibi inceleyebiliyorsun.

### Otonom proje üretimi
- "yeni proje" komutu/formu → Claude Code CLI'ı arka planda spawn ederek gerçek bir proje yazar
- **Üç fazlı sistem** (Plan → Onay → Çalıştırma):
  1. **Plan Fazı** (`--permission-mode plan`): Dosya sistemi dokunulmadan salt-okunur keşif, stack seçimi, dosya yapısı önizlemesi
  2. **Onay Fazı**: Türkçe plan metni kullanıcıya gösteriliyor, **ONAYLA** veya **REDDET** seçeneği
  3. **Çalıştırma Fazı** (`--permission-mode bypassPermissions`): Onay verilirse gerçek dosya yazma başlıyor
- SSE ile canlı log akışı, iş geçmişi, durdurma desteği (tüm fazlarda)

### Diğer
- Web arama (Tavily), YouTube video oynatma, harita (OpenStreetMap/Nominatim)
- **YouTube müzik çalma** — küçük widget, ekolayzer animasyonu
- Son dakika haberi isteğinde direkt video açılır (seçenek sorulmaz)
- Saat/tarih sorma — tamamen yerel, LLM veya internet gerektirmez
- Sağ orta metrikler paneli (`DataPanels.tsx`) şu an **mock veriyle** çalışıyor
  (gerçek CPU/RAM/network metriklerine henüz bağlanmadı)

### El jestleri (webcam)

Ana görünümde:

| Jest | Etki |
| --- | --- |
| Tek el pinch (baş+işaret parmak) + sürükle | Orb'u döndür |
| İki el pinch + uzaklaş/yakınlaş | Zoom in/out |
| Üç parmak açık (herhangi bir el) | Müziği duraklat/devam ettir |
| Sağ el yumruk | Önceki şarkı |
| Sol el yumruk | Sonraki şarkı |

Edit Mode açıkken (yukarıdaki [3D model — düzenleme ve montaj](#3d-model--düzenleme-ve-montaj-edit-mode)
bölümüne bakın), aynı el takip altyapısı farklı bir anlam kazanıyor:

| Jest / girdi | Etki (Edit Mode içinde) |
| --- | --- |
| Serbest el hareketi (pinch yok) | Seçili model(ler)i veya merkez küreyi (tüm montajı) döndür |
| Tek el pinch + hareket | Seçimi kamera düzleminde sürükle |
| İki el pinch + uzaklaş/yakınlaş | Edit Mode kamerasında zoom |
| Üç parmak açık | Seçime küçük bir eğim (pitch) darbesi ver |
| Mouse tıkla / sürükle | Model seç / sürükle (klavye-fare ile de tam kontrol) |

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
OLLAMA_EMBED_MODEL=nomic-embed-text    # semantic embedding modeli (barge-in için)

# Barge-in sistemi
NEXT_PUBLIC_ENABLE_SEMANTIC_CHECK=true  # Semantic benzerlik kontrolü aktif/pasif

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
NOVA_MODELS_DIR=                                       # Yerel model kütüphanesi klasörü — "modelleri getir" ve
                                                        # Meshy'den kaydedilen STL'ler burada birleşir (varsayılan: Masaüstü\models)
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
| "sus" / "uyu" / "sessiz ol" / "bekleme moduna geç" / "kapat" / "görüşürüz nova" / "bay bay nova" | Uyku moduna geç (konuşurken bile kesme yok) |
| "vazgeç" | Açık olan her şeyi iptal et |
| "yaklaştır" / "büyüt" / "zoom yap" | Orb'a zoom in |
| "uzaklaştır" / "küçült" / "zoom out" | Orb'dan zoom out |
| "sıfırla" / "resetle" / "başa dön" | Orb kamerasını sıfırla |
| "saat kaç" | Saati Türkçe kelimeyle söyle |
| "tarih" / "bugün" / "hangi gün" | Bugünün tarihini söyle |
| "[şarkı adı] çal" / "müzik aç" / "çalar mısın" | YouTube'dan müzik ara ve çal |
| "müziği durdur/duraklat" / "müziğe devam et" / "müziği kapat" | Müzik kontrolü |
| "[X] videosunu aç/oynat" / "youtube'dan X" / "X izle" | YouTube'da video aç |
| "[model adı] modelini/kılıfını/parçasını bul/indir/ara" | Thingiverse'de ara, "birinci/ikinci/üçüncü" ile seç |
| "[model adı] modelini yükle/göster/aç" | Yerel kütüphaneden ismiyle doğrudan model aç |
| "nova, modelleri getir" / "model klasörü" | Sabit klasörden (`NOVA_MODELS_DIR`) 3D modelleri toplu yükle |
| "sonraki/önceki model" | Yüklenen model listesinde gez |
| "modeli kaldır/kapat/temizle" | Aktif modeli sahneden çıkar |
| "kamerayı aç" / "nesne tara" | Nesne tara → 3D model üret |
| "kamerayı kapat" / "taramayı kapat" | Kamerayı kapat |
| "ne görüyorsun" / "ne var orada" / "etrafı anlat" / "ortamı anlat" | Kameradaki sahneyi Türkçe cümleyle özetle |
| "yeni proje" / "proje oluştur" | Otonom proje ajanını başlat (plan → onay → çalıştırma) |
| "proje formunu kapat" | Açık proje formunu iptal et |
| "[şehir] haritasını göster" | Harita aç |
| "haritayı kapat" / "haritayı gizle" | Haritayı kapat |
| "son dakika haberleri" / "güncel haber" | Direkt haber videosu aç |
| "şunu öğren: ..." / "bunu not al: ..." / "bunu hatırla: ..." | Davranışsal ders olarak `nova_lessons.md`'ye kaydet |
| "adım X" / "ismim X" / "beni X olarak çağır/adlandır" | Kullanıcı adını `nova_profile.json`'a kaydet |
| "tercihimi kaydet: ..." / "bunu tercih olarak kaydet: ..." | Tercihler listesine ekle (max 40, otomatik dedupe) |

> **Not:** Yukarıdakilerin hiçbiri Edit Mode'u açmaz — o, HUD'daki **EDIT MODE** butonuyla
> açılan, bilinçli olarak sesle değil elle/mouse ile kontrol edilen ayrı bir moddur (bkz.
> [3D model — düzenleme ve montaj](#3d-model--düzenleme-ve-montaj-edit-mode)). Yukarıdaki
> tabloda yer almayan, haber/fiyat/döviz/hava durumu/"kimdir"/"nedir" gibi doğal dil
> soruları da otomatik olarak Tavily web aramasıyla zenginleştirilip Ollama'ya yönlendirilir.

## El jestleri

Yukarıdaki [Özellikler](#özellikler) bölümündeki iki ayrı tabloya bakın: biri ana
görünüm için, diğeri Edit Mode içindeyken aynı jestlerin farklı anlamları için. Kamera
açıkken sağ alttaki "JESTLER" butonuyla el takibini açıp kapatabilirsiniz.

---

## Mimari

```
app/
  page.tsx                   Sadece <NovaOrb /> (=JarvisOrb.tsx) ve <DataPanels />'i render eder —
                              diğer tüm paneller (ObjectScanner, ProjectForm, ModelBrowser, MapView,
                              MusicPlayer, VideoOverlay, EditModeUI, TransformPanel) JarvisOrb.tsx
                              içinde şarta bağlı olarak mount edilir
  api/                        Next.js API route'ları — tüm dış servisler buradan proxy'lenir
    llm/                       Ollama proxy + status + streaming TTS
    embedding/                 Ollama nomic-embed-text semantic embedding (barge-in için)
    stt/                       whisper.cpp proxy (Electron sesli komut fallback'i)
    tts/                       msedge-tts proxy
    profile/                   Kullanıcı profili (isim, tercihler)
    self-update/               Öğrenilen notlar (nova_lessons.md)
    services/{search,geocode,thingiverse}/
    project/                   Otonom proje ajanı (plan → onay → çalıştırma)
    detect/                     Kameradan nesne tespiti — `mode: "detect"` (Meshy için) ve
                                 `mode: "describe"` (sahneyi Türkçe anlatma) ikisini de sunar
    generate3d/                 Meshy ile 3D model üretimi + polling
    generate3d/save/            Üretilen STL'i yerel model klasörüne kaydet (`lib/modelsStore.ts`,
                                 sadece meshy.ai host'una izin veren SSRF koruması var)
    models/[fileName]/          Yerel model klasöründen dosya sunan GET route (stl/glb/gltf/obj)
    slicer/                     Modeli indirip Creality Print/Slicer'da açar
    youtube/                    Video + müzik arama

lib/
  useVoice.ts                Ana ses/LLM hook'u — komut motoru, TTS, sohbet akışı
  useAlwaysOn.ts              Arka plan wake-word döngüsü
  intelligentBargeIn.ts       Barge-in sistemi: intent analiz + keyword + semantic benzerlik
  speechEngine.ts             Web Speech API ↔ Whisper fallback soyutlaması
  chime.ts                    Dinleme başlangıcı "bing" sesi (Web Audio API, sentezlenmiş)
  handTracker.ts              MediaPipe el takibi + jest tanıma (ana görünüm ve Edit Mode ikisinde de kullanılır)
  orbScene.ts                  Three.js ana sahne — normal orb görünümü + Edit Mode'dan gelen montajları (`loadAssembly`) gösterir
  editScene.ts                 Edit Mode için ayrı Three.js sahnesi: model seçme, sürükleme, döndürme,
                                dairesel dizilim, montaj küresi tespiti
  useEditMode.ts               editScene.ts'i React'e bağlayan hook (seçim/model sayısı state'i, EditModeUI/TransformPanel'i besler)
  useModelLibrary.ts           Yüklenen model dosyalarının listesi/state yönetimi
  useObjectDetector.ts         `/api/detect` çağrısını saran hook (hem tespit hem sahne betimleme modu)
  modelsStore.ts               Sunucu tarafı: yerel model klasörünü (NOVA_MODELS_DIR) okuma/yazma, Türkçe dosya adı slugify
  projectAgent.ts              Claude Code CLI spawn/yönetim
  memory.ts                    Konuşma geçmişi + kalıcı depolama

components/
  JarvisOrb.tsx                Uygulamanın ana bileşeni — orb sahnesi, el takibi, ses hook'u, model
                                kütüphanesi, nesne tespiti, Edit Mode ve tüm overlay panellerinin bağlandığı yer
  EditModeUI.tsx                Edit Mode üst-sol istatistik paneli (model/seçim sayısı, jest ipuçları)
  TransformPanel.tsx            Edit Mode üst-sağ panel (ODAKLAN / SİL), seçim varken görünür
  ObjectScanner.tsx, ProjectForm.tsx, ModelBrowser.tsx, MapView.tsx, MusicPlayer.tsx,
  VideoOverlay.tsx, VideoPanel.tsx, DataPanels.tsx  (DataPanels şu an mock veri kullanıyor)

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

### Intelligent Barge-In sınırlı veya çalışmıyor

1. **Embedding modeli eksik**: `ollama pull nomic-embed-text` komutunu çalıştır (ilk kez ~100MB)
2. **Semantic kontrol devre dışı**: `.env.local`'da `NEXT_PUBLIC_ENABLE_SEMANTIC_CHECK=true` olduğundan emin ol
3. **Latency sorunu**: İlk embedding çağrısı yavaş olabilir (model cache'leniyor), sonrasında hızlı (in-memory cache)
4. **Test etme**: Nova konuşurken "dur"/"kapat" diyerek kesme yap — barge-in dinleyicisi tetiklenmelidir

**Barge-in nasıl çalışır?**
- Konuşa başladığında `startBargeInListener()` açılıyor
- Seçilen metin kaydedilince `intelligentBargeInHandler()` kutsalıyor:
  - Mod komutu mu? (video, harita, müzik vb.) → direkt ele al
  - Konu devamı mı? (keyword + semantic benzerlik) → doğal devam et
  - Zayıf bağlantı mı? → bridge kur
  - Başka konu mu? → temiz break yap
- Sistem promptuna kontekst ekleniyor → Nova'nın cevabı bağlama uygun oluyor

---

## License

MIT
