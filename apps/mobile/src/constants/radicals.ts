/**
 * radicals.ts
 * Maps radical characters to their Japanese dictionary names (部首名).
 *
 * Entries cover:
 *  • Standard (Kangxi) forms — these are what the DB stores after the
 *    KANJIDIC2 backfill, e.g. 人 for radical #9, 艸 for #140.
 *  • Common component variants, e.g. 亻(ninben), 氵(sanzui), 艹(kusakanmuri).
 *
 * Names use the kanji-dictionary convention: the most recognisable label
 * comes first (e.g. "ninben" rather than "hito") so learners can cross-
 * reference standard dictionaries.
 */

export const RADICAL_NAMES: Record<string, string> = {

  // ── 1–8: stroke radicals ──────────────────────────────────────────────────
  '一': 'ichi',
  '丨': 'tatebou',
  '丶': 'ten',
  '丿': 'no',
  '乙': 'otsu',
  '亅': 'hane',
  '二': 'ni',
  '亠': 'nabebuta',

  // ── 9: person ─────────────────────────────────────────────────────────────
  // Standard form 人 and side-component form 亻 both map to "ninben"
  '人': 'ninben',
  '亻': 'ninben',
  '儿': 'hitoashi',
  '入': 'nyuu',
  '八': 'hachi',

  // ── 13–17: enclosures ─────────────────────────────────────────────────────
  '冂': 'dougamae',
  '冖': 'wankamuri',
  '囗': 'kunigamae',
  '匚': 'hakogamae',
  '匸': 'kakushigamae',

  // ── 15: ice / water ───────────────────────────────────────────────────────
  // Radical #85: standard form 水 = sanzui; 氵 (left variant) = sanzui
  '冫': 'nisui',
  '水': 'sanzui',
  '氵': 'sanzui',

  // ── 16–17: furniture ──────────────────────────────────────────────────────
  '几': 'tsukue',
  '凵': 'ukehari',

  // ── 18–19: knife / power ──────────────────────────────────────────────────
  '刀': 'rittou',
  '刂': 'rittou',
  '力': 'chikara',

  // ── 21–23: spoon / box ────────────────────────────────────────────────────
  '勺': 'hachi',
  '匕': 'saji',

  // ── 24–29: numbers / basics ───────────────────────────────────────────────
  '十': 'juu',
  '卜': 'boku',
  '卩': 'fushizukuri',
  '厂': 'gandare',
  '厶': 'mu',
  '又': 'mata',

  // ── 30–32: mouth / earth ──────────────────────────────────────────────────
  '口': 'kuchi',
  '囗': 'kunigamae',
  '土': 'tsuchi',
  '士': 'samurai',

  // ── 34–36: walk / evening ─────────────────────────────────────────────────
  '夂': 'fuyu',
  '夊': 'suiashinyo',
  '夕': 'yuu',

  // ── 37–39: big / woman / child ────────────────────────────────────────────
  '大': 'dai',
  '女': 'onnahen',
  '子': 'ko',

  // ── 40: roof ──────────────────────────────────────────────────────────────
  '宀': 'ukanmuri',

  // ── 41–42: inch / small ───────────────────────────────────────────────────
  '寸': 'sun',
  '小': 'chiisai',

  // ── 43–45: lame / corpse / sprout ────────────────────────────────────────
  '尢': 'dainomadare',
  '尸': 'shikabane',
  '屮': 'tetsukusa',

  // ── 46–48: mountain / river / craft ──────────────────────────────────────
  '山': 'yama',
  '巛': 'kawa',
  '川': 'kawa',
  '工': 'kou',

  // ── 49–51: self / cloth / dry ─────────────────────────────────────────────
  '己': 'onore',
  '巾': 'habanori',
  '干': 'hoshi',

  // ── 52–56: thread / cliff / bow ───────────────────────────────────────────
  '幺': 'you',
  '广': 'madare',
  '廴': 'ennyou',
  '廾': 'kyougamae',
  '弋': 'shikigamae',
  '弓': 'yumi',
  '彐': 'kei',
  '彡': 'san',

  // ── 60: step ──────────────────────────────────────────────────────────────
  '彳': 'gyouninben',

  // ── 61: heart / mind ──────────────────────────────────────────────────────
  // Standard 心 = kokoro; left-variant 忄 = risshinben; bottom variant ⺗ also risshinben
  '心': 'risshinben',
  '忄': 'risshinben',

  // ── 62–63: weapon / door ──────────────────────────────────────────────────
  '戈': 'hoko',
  '戸': 'tobamae',
  '戶': 'tobamae',

  // ── 64: hand ──────────────────────────────────────────────────────────────
  // Standard 手 = te; left-variant 扌 = tehen
  '手': 'tehen',
  '扌': 'tehen',

  // ── 65–70: branch / strike / sun ──────────────────────────────────────────
  '支': 'shi',
  '攴': 'boku',
  '攵': 'boku',
  '文': 'bun',
  '斗': 'masu',
  '斤': 'ono',
  '方': 'hou',

  // ── 71–74: sun / moon ─────────────────────────────────────────────────────
  '无': 'mu',
  '日': 'hi',
  '曰': 'iwaku',
  '月': 'tsuki',          // NOTE: 月 can also represent 肉 (nikuzuki) in some kanji

  // ── 75: tree ──────────────────────────────────────────────────────────────
  // Standard 木 = ki; when left component = kihen
  '木': 'kihen',

  // ── 76–79: deficient / stop ───────────────────────────────────────────────
  '欠': 'kakeru',
  '止': 'tomeru',
  '歹': 'gachi',
  '殳': 'hokonodukuri',
  '毋': 'haha',
  '母': 'haha',

  // ── 81–84: compare / fur / clan ───────────────────────────────────────────
  '比': 'narabi',
  '毛': 'ke',
  '氏': 'uji',
  '气': 'ki',

  // ── 86: fire ──────────────────────────────────────────────────────────────
  // Standard 火 = hi; bottom variant 灬 = rekka
  '火': 'hi',
  '灬': 'rekka',

  // ── 87–91: claw / father / slice ──────────────────────────────────────────
  '爪': 'tsume',
  '爫': 'tsumekammuri',
  '父': 'chichi',
  '爻': 'kou',
  '片': 'katapira',

  // ── 92–94: animal ─────────────────────────────────────────────────────────
  '牙': 'kiba',
  '牛': 'ushihen',
  '牜': 'ushihen',
  '犬': 'inuhen',
  '犭': 'kemono',

  // ── 95–98: jewel / tile ───────────────────────────────────────────────────
  '玄': 'gen',
  '玉': 'tamahen',
  '王': 'outamahen',      // 王 as component = ōhen / tamahen
  '瓜': 'uri',
  '瓦': 'kawara',

  // ── 99–102: sweet / life / field ──────────────────────────────────────────
  '甘': 'ama',
  '生': 'sei',
  '用': 'you',
  '田': 'ta',

  // ── 103–104: sickness ─────────────────────────────────────────────────────
  '疋': 'hiki',
  '疒': 'yamaidare',
  '癶': 'hataniyou',

  // ── 106–109: white / eye ──────────────────────────────────────────────────
  '白': 'shiro',
  '皮': 'kawa',
  '皿': 'sara',
  '目': 'me',

  // ── 110–112: spear / arrow / stone ────────────────────────────────────────
  '矛': 'hoko',
  '矢': 'ya',
  '石': 'ishi',

  // ── 113: show / altar ─────────────────────────────────────────────────────
  // Standard 示 = shimesu; left-variant 礻 = shimesuhen
  '示': 'shimesuhen',
  '礻': 'shimesuhen',

  // ── 114–117: grain / hole / stand ─────────────────────────────────────────
  '禸': 'juu',
  '禾': 'nogihen',
  '穴': 'ana',
  '立': 'tatsu',

  // ── 118–120: bamboo / rice / thread ───────────────────────────────────────
  '竹': 'takekammuri',
  '⺮': 'takekammuri',
  '米': 'kome',
  '糸': 'itohen',
  '纟': 'itohen',

  // ── 121–122: jar / net ────────────────────────────────────────────────────
  '缶': 'kame',
  '网': 'amikashira',
  '罒': 'amikashira',

  // ── 123–124: sheep / feather ──────────────────────────────────────────────
  '羊': 'hitsuji',
  '⺷': 'hitsuji',
  '羽': 'hane',

  // ── 125–128: old / ear ────────────────────────────────────────────────────
  '老': 'oikammuri',
  '耂': 'oikammuri',
  '而': 'shikashite',
  '耒': 'suki',
  '耳': 'mimi',
  '聿': 'fude',

  // ── 130: flesh / meat ─────────────────────────────────────────────────────
  // 肉 as a standalone radical; when used as left component it looks like 月 (nikuzuki)
  '肉': 'nikuzuki',

  // ── 131–134: self / arrive ────────────────────────────────────────────────
  '臣': 'omi',
  '自': 'mizukara',
  '至': 'itaru',
  '臼': 'usu',

  // ── 135–139: tongue / boat ────────────────────────────────────────────────
  '舌': 'shita',
  '舛': 'mairiken',
  '舟': 'fune',
  '艮': 'urashima',
  '色': 'iro',

  // ── 140: grass ────────────────────────────────────────────────────────────
  // Standard 艸 = kusakanmuri; top variant 艹 = kusakanmuri
  '艸': 'kusakanmuri',
  '艹': 'kusakanmuri',
  '⺾': 'kusakanmuri',

  // ── 141–143: tiger / insect / blood ───────────────────────────────────────
  '虍': 'torakashira',
  '虫': 'mushi',
  '血': 'chi',

  // ── 144–145: walk / clothes ───────────────────────────────────────────────
  '行': 'gyougamae',
  '衣': 'koromohen',
  '衤': 'koromohen',

  // ── 146–148: west / see / horn ────────────────────────────────────────────
  '覀': 'nishikashira',
  '西': 'nishi',
  '見': 'miru',
  '角': 'tsuno',

  // ── 149: speech ───────────────────────────────────────────────────────────
  // Standard 言 = gonben; simplified left variant 訁 = gonben
  '言': 'gonben',
  '訁': 'gonben',

  // ── 150–153: valley / bean / pig ──────────────────────────────────────────
  '谷': 'tani',
  '豆': 'mame',
  '豕': 'inoko',
  '豸': 'mukade',

  // ── 154–155: shell / red ──────────────────────────────────────────────────
  '貝': 'kaihen',
  '赤': 'aka',

  // ── 156–159: run / foot / vehicle ─────────────────────────────────────────
  '走': 'sounyou',
  '足': 'ashihen',
  '⻊': 'ashihen',
  '身': 'mi',
  '車': 'kuruma',

  // ── 160–163: bitter / village ─────────────────────────────────────────────
  '辛': 'karai',
  '辰': 'tatsu',
  '辵': 'shinnyou',
  '辶': 'shinnyou',
  '邑': 'mura',
  '阝': 'kozatohen',      // left = kozatohen (mound); right = oozato (village)

  // ── 164–166: rooster / divide / village ───────────────────────────────────
  '酉': 'tori',
  '釆': 'nori',
  '里': 'sato',

  // ── 167–169: metal / gate ─────────────────────────────────────────────────
  // Standard 金 = kanehen; left variant 钅 = kanehen
  '金': 'kanehen',
  '钅': 'kanehen',
  '長': 'nagai',
  '門': 'mongamae',

  // ── 170–172: mound / short-bird ───────────────────────────────────────────
  '阜': 'kozato',
  '隶': 'naga',
  '隹': 'furutori',

  // ── 173–175: rain / blue ──────────────────────────────────────────────────
  '雨': 'ame',
  '青': 'ao',
  '非': 'hi',

  // ── 176–179: face / leather ───────────────────────────────────────────────
  '面': 'men',
  '革': 'kawa',
  '韋': 'nameshigawa',
  '韭': 'nira',

  // ── 180–186: sound / food ─────────────────────────────────────────────────
  '音': 'oto',
  '頁': 'ookubi',
  '風': 'kaze',
  '飛': 'tobu',
  '食': 'shokuhen',
  '飠': 'shokuhen',
  '首': 'kubi',
  '香': 'kaoru',

  // ── 187–193: horse / bone / demon ─────────────────────────────────────────
  '馬': 'umahen',
  '骨': 'hone',
  '髟': 'kami',
  '鬥': 'tatakau',
  '鬯': 'cho',
  '鬲': 'kanamori',
  '鬼': 'oni',

  // ── 194–199: fish / bird / deer ───────────────────────────────────────────
  '魚': 'sakana',
  '鳥': 'tori',
  '鹵': 'shio',
  '鹿': 'shika',
  '麥': 'mugi',
  '麦': 'mugi',
  '麻': 'asa',

  // ── 200–203: yellow / black ───────────────────────────────────────────────
  '黃': 'ki',
  '黄': 'ki',
  '黍': 'kibi',
  '黒': 'kuro',
  '黹': 'nui',

  // ── 204–213: rare radicals ────────────────────────────────────────────────
  '黽': 'kaeru',
  '鼎': 'kanae',
  '鼓': 'tsuzumi',
  '鼠': 'nezumi',
  '鼻': 'hana',
  '齊': 'hitoshi',
  '斉': 'hitoshi',
  '齒': 'ha',
  '歯': 'ha',
  '龍': 'ryuu',
  '竜': 'ryuu',
  '龜': 'kame',
  '亀': 'kame',

  // ── common visual components (appear in seed data, not Kangxi radicals) ────
  '亜': 'a',
  '弜': 'kyou',
  'ナ': 'mata',           // katakana-looking component, variant of 又
}

/**
 * Returns the Japanese name for a radical character, or null if unknown.
 */
export function getRadicalName(char: string): string | null {
  return RADICAL_NAMES[char] ?? null
}
