# Kategori Botu

Bu proje, belirlenen kategori(ler) içindeki tüm kanallara hedef bir rol için izinleri toplu uygulayan bir Discord botudur.
Özellikler:
- Dry-run: hangi kanallara uygulanacağını listeler.
- Apply: ViewChannel ve SendMessages izinlerini ALLOW edip diğer tüm izinleri DENY eder.
- Backup: uygulamadan önce mevcut role overwrites'larını JSON olarak kaydeder.
- Restore: kaydedilmiş yedeği geri yükler.

Kurulum:
1. Node 18+ kurun.
2. `npm install`
3. Ortam değişkenlerini ayarlayın: `BOT_TOKEN` ve `GUILD_ID`
4. `node index.js`

Çalıştırma örnekleri (konsolda):
- Dry-run:
  dry 123456789012345678 111111111111111111,222222222222222222

- Apply (yedek ile):
  apply 123456789012345678 111111111111111111,222222222222222222 --backup before.json

- Restore:
  restore before.json

Uyarılar:
- Botun rolü hedef rolden daha yüksek olmalı ve Manage Channels yetkisine sahip olmalı.
- Her zaman önce dry-run ve/veya backup çalıştırın.
