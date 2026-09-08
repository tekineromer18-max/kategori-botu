// Node 18+ ve discord.js v14 gerektirir
// Kurulum:
//   npm init -y
//   npm install discord.js@14
//
// Çalıştırma:
//   BOT_TOKEN=xxx GUILD_ID=yyy node index.js
//
// Komutlar (tek satır / konsola yaz):
//   dry ROLE_ID CATEGORY_ID1,CATEGORY_ID2[,...]
//     -> Dry-run: hangi kanallara ne uygulanacağını listeler, değişiklik yapmaz.
//
//   apply ROLE_ID CATEGORY_ID1,CATEGORY_ID2[,...] [--backup filename.json]
//     -> Belirtilen kategorilerdeki tüm kanallara hedef rolü ekler; izinleri
//        yalnızca ViewChannel & SendMessages = true, diğer tüm izinleri explicit false (deny).
//        Eğer --backup filename.json eklersen, değişiklik yapmadan önce etkilenecek kanalların
//        mevcut role overwrites'larını filename.json olarak kaydeder.
//
//   backup filename.json ROLE_ID CATEGORY_ID1,CATEGORY_ID2[,...]
//     -> Sadece yedek alır (uygulama yapmaz). filename.json oluşturulur.
//
//   restore filename.json
//     -> filename.json'daki yedeği okuyup kanallardaki role overwrites'ları geri yükler.
//
// Örnekler:
//   dry 123456789012345678 111111111111111111,222222222222222222
//   apply 123456789012345678 111111111111111111,222222222222222222 --backup before.json
//   backup before.json 123456789012345678 111111111111111111
//   restore before.json

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Client, GatewayIntentBits, PermissionsBitField, ChannelType } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const GUILD_ID = process.env.GUILD_ID || '';

if (!BOT_TOKEN || !GUILD_ID) {
  console.error('Lütfen BOT_TOKEN ve GUILD_ID ortam değişkenlerini ayarlayın.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const wait = (ms) => new Promise(res => setTimeout(res, ms));

/** Tüm permission flag isimleri */
const ALL_FLAGS = Object.keys(PermissionsBitField.Flags);

client.once('ready', async () => {
  console.log(`Bot giriş yaptı: ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID).catch(err => {
    console.error('Guild alınamadı:', err);
    process.exit(1);
  });

  console.log('Komut bekleniyor. Yardım için "help" yaz.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  rl.on('line', async (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (line.toLowerCase() === 'help') {
      console.log('Komutlar:');
      console.log('  dry ROLE_ID CAT1,CAT2,...');
      console.log('  apply ROLE_ID CAT1,CAT2,... [--backup filename.json]');
      console.log('  backup filename.json ROLE_ID CAT1,CAT2,...');
      console.log('  restore filename.json');
      return;
    }

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    try {
      if (cmd === 'dry') {
        // dry ROLE_ID CAT1,CAT2
        const roleId = parts[1];
        const catList = parts[2];
        if (!roleId || !catList) return console.error('dry: ROLE_ID ve en az bir CATEGORY_ID gerekli.');
        await dryRun(guild, roleId, catList.split(',').map(s => s.trim()).filter(Boolean));
      } else if (cmd === 'apply') {
        // apply ROLE_ID CAT1,CAT2 [--backup filename.json]
        const roleId = parts[1];
        const catList = parts[2];
        if (!roleId || !catList) return console.error('apply: ROLE_ID ve en az bir CATEGORY_ID gerekli.');
        const backupIndex = parts.indexOf('--backup');
        let backupFile = null;
        if (backupIndex !== -1) {
          backupFile = parts[backupIndex + 1];
          if (!backupFile) return console.error('apply: --backup için bir dosya adı verin.');
        }
        await applyPermissions(guild, roleId, catList.split(',').map(s => s.trim()).filter(Boolean), backupFile);
      } else if (cmd === 'backup') {
        // backup filename.json ROLE_ID CAT1,CAT2
        const filename = parts[1];
        const roleId = parts[2];
        const catList = parts[3];
        if (!filename || !roleId || !catList) return console.error('backup: filename ROLE_ID CATEGORY_LIST gerekli.');
        await backupOnly(guild, filename, roleId, catList.split(',').map(s => s.trim()).filter(Boolean));
      } else if (cmd === 'restore') {
        // restore filename.json
        const filename = parts[1];
        if (!filename) return console.error('restore: filename gerekli.');
        await restoreFromFile(guild, filename);
      } else {
        console.log('Bilinmeyen komut. Yardım için "help" yaz.');
      }
    } catch (err) {
      console.error('İşlem sırasında hata:', err?.message || err);
    }
  });
});

/** Dry-run: hangi kanallara uygulanacağını ve mevcut overwrites'ı listeler */
async function dryRun(guild, roleId, categoryIds) {
  const role = await fetchRole(guild, roleId);
  if (!role) return console.error('dry-run: rol bulunamadı:', roleId);

  const allChannels = await guild.channels.fetch();
  const affected = collectCategoryChannels(allChannels, categoryIds);

  console.log(`Dry-run: rol ${role.name} (${role.id}) için ${affected.length} kanal etkilenecek.`);
  for (const ch of affected) {
    const ow = ch.permissionOverwrites.cache.get(role.id);
    const allow = ow ? ow.allow.toArray() : [];
    const deny = ow ? ow.deny.toArray() : [];
    console.log(`- ${ch.name || ch.id} (${ch.id}) | mevcut allow: [${allow.join(', ')}] deny: [${deny.join(', ')}]`);
  }
  console.log('Dry-run bitti. Gerçek uygulama için apply komutunu kullanın.');
}

/** Backup-only: sadece yedek al */
async function backupOnly(guild, filename, roleId, categoryIds) {
  const allChannels = await guild.channels.fetch();
  const affected = collectCategoryChannels(allChannels, categoryIds);
  if (affected.length === 0) return console.log('Yedeklenecek kanal bulunamadı.');

  const backup = buildBackupEntries(affected, roleId);
  writeBackupFile(filename, backup);
  console.log(`Yedek oluşturuldu: ${filename} (${backup.length} kanal)`);
}

/** Apply: (opsiyonel backup) sonra izinleri uygula */
async function applyPermissions(guild, roleId, categoryIds, backupFile) {
  const role = await fetchRole(guild, roleId);
  if (!role) return console.error('apply: rol bulunamadı:', roleId);

  const allChannels = await guild.channels.fetch();
  const affected = collectCategoryChannels(allChannels, categoryIds);
  if (affected.length === 0) return console.log('Uygulanacak kanal bulunamadı.');

  if (backupFile) {
    const backup = buildBackupEntries(affected, roleId);
    writeBackupFile(backupFile, backup);
    console.log(`Ön yedek alındı: ${backupFile}`);
  }

  // Hazır overwrite: tüm izinleri DENY (false), sonra View+Send = true
  const overwrite = {};
  for (const f of ALL_FLAGS) overwrite[f] = false;
  overwrite.ViewChannel = true;
  overwrite.SendMessages = true;

  let changed = 0;
  for (const ch of affected) {
    try {
      console.log(`Uygulanıyor -> ${ch.name || ch.id} (${ch.id})`);
      await ch.permissionOverwrites.edit(role, overwrite, { reason: 'Toplu kategori izin uygulaması' });
      changed++;
      await wait(250);
    } catch (err) {
      console.warn(`Hata ${ch.name || ch.id}:`, err?.message || err);
    }
  }

  console.log(`Uygulama tamamlandı. Güncellenen kanal sayısı: ${changed}/${affected.length}`);
}

/** Restore: yedekten geri al */
async function restoreFromFile(guild, filename) {
  if (!fs.existsSync(filename)) return console.error('restore: dosya bulunamadı:', filename);
  const raw = fs.readFileSync(filename, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) return console.error('restore: dosya formatı geçersiz.');

  let restored = 0;
  for (const entry of data) {
    const { channelId, roleId, allow = [], deny = [] } = entry;
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (!ch) {
      console.warn(`Restore: kanal bulunamadı: ${channelId}`);
      continue;
    }
    // Delete existing overwrite for role, then recreate with saved allow/deny
    try {
      await ch.permissionOverwrites.delete(roleId).catch(()=>null);
      const role = await guild.roles.fetch(roleId).catch(()=>null);
      if (!role) {
        console.warn(`Restore: rol bulunamadı: ${roleId} (kanal ${channelId})`);
        continue;
      }
      const obj = {};
      // set only permission flags present in allow/deny
      for (const f of allow) {
        if (ALL_FLAGS.includes(f)) obj[f] = true;
      }
      for (const f of deny) {
        if (ALL_FLAGS.includes(f)) obj[f] = false;
      }
      if (Object.keys(obj).length > 0) {
        await ch.permissionOverwrites.edit(role, obj, { reason: `Restore from backup ${path.basename(filename)}` });
      }
      restored++;
      await wait(200);
    } catch (err) {
      console.warn(`Restore hata ${channelId}:`, err?.message || err);
    }
  }
  console.log(`Restore tamamlandı. Geri yüklenen kayıt sayısı: ${restored}/${data.length}`);
}

/** Yardımcı: role fetch */
async function fetchRole(guild, roleId) {
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

/** Belirtilen kategori ID'lerinden kategorinin child kanallarını topla (sadece text-based) */
function collectCategoryChannels(allChannelsCollection, categoryIds) {
  const result = [];
  for (const catId of categoryIds) {
    const cat = allChannelsCollection.get(catId);
    if (!cat) {
      console.warn(`Kategori ID bulunamadı: ${catId}`);
      continue;
    }
    if (cat.type !== ChannelType.GuildCategory) {
      console.warn(`ID kategori değil atlandı: ${catId} (${cat.name || 'isim yok'})`);
      continue;
    }
    // child kanalları filtrele
    const children = allChannelsCollection.filter(ch => ch.parentId === cat.id);
    for (const [, ch] of children) {
      // sadece metin tabanlı kanallar (text, news, forum gibi isTextBased:true olanları seçiyoruz)
      if (ch && typeof ch.isTextBased === 'function' && ch.isTextBased()) {
        result.push(ch);
      }
    }
  }
  // unique by id
  const uniq = Array.from(new Map(result.map(c => [c.id, c])).values());
  return uniq;
}

/** Backup için entry listesi hazırla */
function buildBackupEntries(channels, roleId) {
  const entries = [];
  for (const ch of channels) {
    const ow = ch.permissionOverwrites.cache.get(roleId);
    if (!ow) {
      // rol için overwrite yok -> kaydet empty
      entries.push({ channelId: ch.id, roleId, allow: [], deny: [] });
    } else {
      entries.push({
        channelId: ch.id,
        roleId,
        allow: ow.allow.toArray(),
        deny: ow.deny.toArray()
      });
    }
  }
  return entries;
}

/** Yedek dosyası yaz */
function writeBackupFile(filename, data) {
  try {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    throw new Error('Yedek dosyası yazılamadı: ' + err.message);
  }
}

client.login(BOT_TOKEN).catch(err => {
  console.error('Bot giriş hatası:', err);
});
