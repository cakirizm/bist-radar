# BIST Radar V1

Kişisel kullanım için sade BIST teknik tarayıcı.

## Ne yapıyor?
- Sunucu tarafında Yahoo Finance chart endpoint'inden günlük fiyat geçmişi + güncel fiyat metadatası çeker.
- EMA20 / EMA50 / EMA200, RSI14, MACD, 20/60/120 günlük momentum, hacim oranı, volatilite ve BIST100'e relatif güç hesaplar.
- Hisseleri Radar skoru ile sıralar.
- Tarayıcıdaki önceki taramayı `localStorage`'da tutar ve yeni radar / güçlü kalan / erken sinyal / zayıflayan kategorilerini çıkarır.
- Sayfa açıkken 15 dakikada bir otomatik yeniden tarar.
- TradingView iframe/widget kullanmaz.

## Önemli
Yahoo Finance endpoint'i resmi/garantili bir geliştirici API'si değildir. Bu V1 kişisel kullanım ve prototip içindir. Gerçek zamanlı/lisanslı veri için daha sonra Matriks/Finnet vb. bir sağlayıcıya geçilebilir. Arayüz ve analiz motoru veri kaynağından ayrıldığı için bu değişim kolaydır.

## Ofis PC'de nasıl kullanılır?
Bu proje tek başına `index.html` dosyasına çift tıklanarak canlı veri çekemez; `/api/scan` için küçük bir web sunucusu gerekir. En kolay yol Vercel'e yüklemektir.

### Vercel'e yükleme
1. Bu klasörü GitHub'a repo olarak yükleyin.
2. Vercel hesabında **Add New > Project** deyin.
3. GitHub reposunu seçin.
4. Framework Preset: **Other** kalabilir.
5. Build command boş, Output Directory boş.
6. Deploy.
7. Vercel size `https://...vercel.app` adresi verir. Ofis PC'de Edge/Chrome favorilerine ekleyin.

## Evreni değiştirmek
`api/universe.js` içindeki ticker listesini değiştirin. `.IS` eklemeyin; backend otomatik ekler.

## V1 skor ağırlıkları
- Trend: %33
- Momentum: %27
- Hacim: %14
- BIST100'e relatif güç: %16
- Risk: %10

Bu skor yatırım tavsiyesi değildir; tarama ve önceliklendirme aracıdır.
