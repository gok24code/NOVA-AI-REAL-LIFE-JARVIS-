// NOVA'nın sesli komutla tetiklediği ve Ollama'ya "az önce ne yaptın" diye
// anlatacağı eylemlerin Türkçe açıklamaları. Ollama'nın hem bu eylemin ne işe
// yaradığını bilmesi hem de sonucu şablon değil, doğal/özgün bir cümleyle
// haber vermesi için kullanılıyor (bkz. lib/useVoice.ts -> narrateAction).
//
// Not: Bu, Ollama'nın native "tool calling" (fonksiyon çağırma) API'sini
// kullanmıyor — hangi fonksiyonun çağrılacağı hâlâ hızlı/güvenilir tetikleyici-
// kelime eşleştirmesiyle (lib/useVoice.ts) belirleniyor. Ollama sadece,
// eylem zaten gerçekleştikten SONRA sonucu nasıl anlatacağına karar veriyor.
// Sebep: zoom/uyku gibi anlık komutlarda LLM turu gecikme ve yanlış çağrı
// riski ekler; burada asıl istenen (şablon yerine özgün geri bildirim) için
// gerekli değil.
export const NOVA_ACTION_DESCRIPTIONS: Record<string, string> = {
  play_music: "Kullanıcının istediği şarkıyı veya sanatçıyı YouTube üzerinden bulup orb'un yanında beliren küçük bir müzik widget'ında çalmaya başlıyorsun.",
  show_map: "İstenen şehri OpenStreetMap üzerinden bulup orb'un önünde açılan bir harita panelinde gösteriyorsun.",
  load_model_folder: "Kullanıcının yerel 3D model klasöründeki dosyaları tarayıp sahneye ilk modeli yüklüyorsun.",
  search_model: "Kullanıcının tarif ettiği nesnenin hazır 3D modelini Thingiverse üzerinden internetten arayıp ilk üç-beş sonucu sunuyorsun.",
  stop_all: "Açık olan her paneli (harita, müzik, kamera/tarama, model tarayıcı, proje formu, video) kapatıp konuşmayı/işlemi anında kesiyorsun — kullanıcı kaos anında 'her şeyi durdur' anlamına gelen bir şey söylediğinde.",
};

export type NovaActionKey = keyof typeof NOVA_ACTION_DESCRIPTIONS;

// Bu alt küme, LLM'in serbest konuşmadan ("müzik çal" gibi net bir komut
// söylemeden) niyet çıkarıp GERÇEKTEN tetikleyebileceği eylemler — bkz.
// lib/useVoice.ts -> classifyAction. load_model_folder burada yok çünkü
// belirsiz bir argümanı yok ve yanlışlıkla tetiklenmesi (gereksiz dosya
// okuma) diğerlerinden daha maliyetli. search_model burada VAR çünkü
// tetikleyici-kelime eşleşmesi ("model ara" tam substring'i) STT'nin ürettiği
// doğal varyasyonları ("modelini ara", "3 boyutlu modeli bulur musun" vb.)
// kaçırıyor — bu, o durumlarda devreye giren bir güvenlik ağı.
export const CLASSIFIABLE_ACTION_KEYS = ["play_music", "show_map", "stop_all", "search_model"] as const;
export type ClassifiableActionKey = (typeof CLASSIFIABLE_ACTION_KEYS)[number];
