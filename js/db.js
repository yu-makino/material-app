// ============================================
// IndexedDB データ層 — イベントソーシング方式
// ============================================

const DB_NAME = 'MaterialApp';
const DB_VERSION = 6;

// 径間マスタ（そうろう橋・固定）
const SPANS = [
  'A1-P1', 'P1-P2', 'P2-P3', 'P3-P4',
  'P4-P5', 'P5-P6', 'P6-P7', 'P7-P8',
  'P13-P14', 'P14-P15', 'P15-P16', 'P16-P17'
];

// 設計数量（炭素繊維シート貼り付け面積 m²）
const DESIGN_AREAS = {
  'P1-P2': 346.6,
  'P2-P3': 357.5,
  'P3-P4': 357.5,
  'P4-P5': 346.6
};

// 工程マスタ（作業手順書ベース14工程）
const PROCESSES = [
  'プライマー塗布',
  'パテ不陸整正',
  '含浸接着樹脂（下塗り）',
  '炭素繊維シート貼付',
  '含浸接着樹脂（上塗り）',
  'CFアンカー',
  '表面仕上げプライマー',
  '表面保護材',
  '珪砂吹き付け'
];

// 材料マスタ（物理的な製品単位 = 搬入・混合の単位）
// 標準使用量はウェブ標準値、kg/m²
const DEFAULT_MATERIALS = [
  {
    id: 'primer',
    sortOrder: 1,
    name: 'エポサームプライマー',
    unit: 'セット',
    packSize: 15,  // 1セット=15kg（主剤+硬化剤）
    packBreakdown: { base: 12, hardener: 3 },  // XPS-400: 主剤12kg+硬化剤3kg
    isTwoComponent: true,
    mixRatio: { base: 4, hardener: 1 },
    mixRatioUnit: '重量比',
    standardUsage: 0.2,
    defaultMargin: 1.1,
    potLife: 40,  // 仮値
    hazardClass: null,
    designatedQty: null
  },
  {
    id: 'putty',
    sortOrder: 2,
    name: 'エポサームパテ',
    unit: 'セット',
    packSize: 15,  // 1セット=15kg（主剤+硬化剤）
    packBreakdown: { base: 10, hardener: 5 },  // 主剤10kg+硬化剤5kg
    isTwoComponent: true,
    mixRatio: { base: 2, hardener: 1 },
    mixRatioUnit: '重量比',
    standardUsage: 1.0,
    defaultMargin: 1.1,
    potLife: 30,  // 仮値
    hazardClass: null,
    designatedQty: null
  },
  {
    id: 'resin',
    sortOrder: 3,
    name: 'エポサームレジン',
    unit: 'セット',
    packSize: 15,  // 1セット=15kg（主剤+硬化剤）
    packBreakdown: { base: 12, hardener: 3 },  // 主剤12kg+硬化剤3kg
    isTwoComponent: true,
    mixRatio: { base: 4, hardener: 1 },
    mixRatioUnit: '重量比',
    standardUsage: 1.7,  // 全工程合計
    defaultMargin: 1.1,
    potLife: 50,  // 仮値
    hazardClass: null,
    designatedQty: null
  },
  {
    id: 'cf_sheet',
    sortOrder: 4,
    name: '炭素繊維シート',
    unit: '巻',
    packSize: 1,
    isTwoComponent: false,
    mixRatio: null,
    mixRatioUnit: null,
    standardUsage: null,
    defaultMargin: 1.0,
    hazardClass: null,
    designatedQty: null
  },
  {
    id: 'primer_finish',
    sortOrder: 5,
    name: '仕上げプライマー',
    unit: 'セット',
    packSize: 1,
    isTwoComponent: true,
    mixRatio: { base: 4, hardener: 1 },  // 要確認
    mixRatioUnit: '重量比',
    standardUsage: 0.1,
    defaultMargin: 1.1,
    potLife: 40,  // 仮値
    hazardClass: null,
    designatedQty: null
  },
  {
    id: 'mortar',
    sortOrder: 6,
    name: '表面保護モルタル',
    unit: 'kg',
    packSize: 1,
    isTwoComponent: false,
    mixRatio: null,
    mixRatioUnit: null,
    standardUsage: 1.4,
    defaultMargin: 1.1,
    potLife: null,
    hazardClass: null,
    designatedQty: null
  }
];

// 工程別の標準使用量（計算用）
// 搬入・混合は材料マスタ単位、使用量計算は工程別に算出
const PROCESS_USAGE = {
  'プライマー塗布':       { materialId: 'primer',         usage: 0.2 },
  'パテ不陸整正':         { materialId: 'putty',          usage: 1.0 },
  '含浸接着樹脂（下塗り）': { materialId: 'resin',          usage: 0.5 },
  '炭素繊維シート貼付':    { materialId: 'cf_sheet',       usage: null },
  '含浸接着樹脂（上塗り）': { materialId: 'resin',          usage: 0.3 },
  'CFアンカー下塗り':      { materialId: 'resin',          usage: 0.3 },
  'CFアンカー上塗り':      { materialId: 'resin',          usage: 0.2 },
  '表面仕上げプライマー':   { materialId: 'primer_finish',  usage: 0.1 },
  '表面保護材':           { materialId: 'mortar',          usage: 1.4 },
  '珪砂吹き付け':         { materialId: 'resin',          usage: 0.4 }
};

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const d = e.target.result;

      // 材料マスタ
      if (!d.objectStoreNames.contains('materials')) {
        d.createObjectStore('materials', { keyPath: 'id' });
      }

      // イベントログ（全操作の追記専用ストア）
      if (!d.objectStoreNames.contains('events')) {
        const store = d.createObjectStore('events', { keyPath: 'eventId', autoIncrement: true });
        store.createIndex('type', 'type');
        store.createIndex('date', 'date');
        store.createIndex('materialId', 'materialId');
        store.createIndex('lotNumber', 'lotNumber');
        store.createIndex('spanId', 'spanId');
        store.createIndex('timestamp', 'timestamp');
      }
    };

    req.onsuccess = e => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = e => reject(e.target.error);
  });
}

// マスタデータを最新で上書き（DB_VERSIONを上げたら自動反映）
// イベントログ（搬入・混合・使用の記録）には影響しない
async function initMaterials() {
  const d = await openDB();
  const tx = d.transaction('materials', 'readwrite');
  const store = tx.objectStore('materials');
  // 旧バージョンの不要な材料を削除してから最新を投入
  const validIds = new Set(DEFAULT_MATERIALS.map(m => m.id));
  const allReq = store.getAll();
  allReq.onsuccess = () => {
    for (const existing of allReq.result) {
      if (!validIds.has(existing.id)) {
        store.delete(existing.id);
      }
    }
    for (const m of DEFAULT_MATERIALS) {
      store.put(m);
    }
  };
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getMaterials() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('materials', 'readonly');
    const req = tx.objectStore('materials').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99)));
    req.onerror = () => reject(req.error);
  });
}

async function updateMaterial(material) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('materials', 'readwrite');
    tx.objectStore('materials').put(material);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================
// イベントの追加（追記のみ・削除不可）
// ============================================

async function addEvent(event) {
  const d = await openDB();
  const record = {
    ...event,
    timestamp: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10)
  };
  return new Promise((resolve, reject) => {
    const tx = d.transaction('events', 'readwrite');
    const req = tx.objectStore('events').add(record);
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

// 搬入イベント
async function addReceiptEvent(materialId, lotNumber, quantity, location, notes) {
  return addEvent({
    type: 'receipt',
    materialId,
    lotNumber,
    quantity: Number(quantity),
    location: location || '足場内',
    notes: notes || ''
  });
}

// 混合イベント
async function addMixingEvent(materialId, lotNumber, baseWeight, hardenerWeight, spanId, process, result) {
  return addEvent({
    type: 'mixing',
    materialId,
    lotNumber,
    baseWeight: Number(baseWeight),
    hardenerWeight: Number(hardenerWeight),
    actualRatio: Number(baseWeight) / Number(hardenerWeight),
    spanId,
    process,
    result  // 'OK' or 'NG'
  });
}

// 使用イベント
async function addUsageEvent(materialId, lotNumber, quantity, spanId, process, notes) {
  return addEvent({
    type: 'usage',
    materialId,
    lotNumber,
    quantity: Number(quantity),
    spanId,
    process,
    notes: notes || ''
  });
}

// 取り消しイベント（元イベントを相殺する補正イベント）
async function addReversalEvent(originalEventId, originalEvent) {
  return addEvent({
    type: 'reversal',
    originalEventId,
    originalType: originalEvent.type,
    materialId: originalEvent.materialId,
    lotNumber: originalEvent.lotNumber,
    quantity: originalEvent.quantity || 0,
    baseWeight: originalEvent.baseWeight || 0,
    hardenerWeight: originalEvent.hardenerWeight || 0,
    spanId: originalEvent.spanId || null,
    process: originalEvent.process || null,
    notes: '取り消し'
  });
}

// 取り消し済みイベントIDの一覧を取得
async function getReversedEventIds() {
  const reversals = await getEvents({ type: 'reversal' });
  return new Set(reversals.map(r => r.originalEventId));
}

// 気温・湿度記録イベント
async function addTemperatureEvent(temperature, humidity, photoDataUrl, notes) {
  return addEvent({
    type: 'temperature',
    temperature: Number(temperature),
    humidity: humidity != null ? Number(humidity) : null,
    photo: photoDataUrl || null,
    notes: notes || ''
  });
}

// ============================================
// クエリ
// ============================================

async function getEvents(filter = {}) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('events', 'readonly');
    const store = tx.objectStore('events');
    let req;

    if (filter.type) {
      req = store.index('type').getAll(filter.type);
    } else if (filter.date) {
      req = store.index('date').getAll(filter.date);
    } else if (filter.lotNumber) {
      req = store.index('lotNumber').getAll(filter.lotNumber);
    } else {
      req = store.getAll();
    }

    req.onsuccess = () => {
      let results = req.result;
      // 追加フィルタ
      if (filter.type && filter.date) {
        results = results.filter(e => e.date === filter.date);
      }
      if (filter.materialId) {
        results = results.filter(e => e.materialId === filter.materialId);
      }
      if (filter.spanId) {
        results = results.filter(e => e.spanId === filter.spanId);
      }
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

// 在庫計算（搬入 − 使用 = 残数）※取り消し済みイベントを除外
async function getInventory() {
  const materials = await getMaterials();
  const receipts = await getEvents({ type: 'receipt' });
  const usages = await getEvents({ type: 'usage' });
  const reversedIds = await getReversedEventIds();

  const inventory = {};
  for (const m of materials) {
    inventory[m.id] = {
      material: m,
      totalReceived: 0,
      totalUsed: 0,
      remaining: 0,
      lots: {}  // lotNumber -> { received, used, remaining }
    };
  }

  for (const r of receipts) {
    if (!inventory[r.materialId]) continue;
    if (reversedIds.has(r.eventId)) continue;  // 取り消し済みはスキップ
    inventory[r.materialId].totalReceived += r.quantity;
    if (!inventory[r.materialId].lots[r.lotNumber]) {
      inventory[r.materialId].lots[r.lotNumber] = { received: 0, used: 0 };
    }
    inventory[r.materialId].lots[r.lotNumber].received += r.quantity;
  }

  for (const u of usages) {
    if (!inventory[u.materialId]) continue;
    if (reversedIds.has(u.eventId)) continue;  // 取り消し済みはスキップ
    inventory[u.materialId].totalUsed += u.quantity;
    if (inventory[u.materialId].lots[u.lotNumber]) {
      inventory[u.materialId].lots[u.lotNumber].used += u.quantity;
    }
  }

  for (const id of Object.keys(inventory)) {
    const inv = inventory[id];
    inv.remaining = inv.totalReceived - inv.totalUsed;
    for (const lot of Object.keys(inv.lots)) {
      inv.lots[lot].remaining = inv.lots[lot].received - inv.lots[lot].used;
    }
  }

  return inventory;
}

// 日次サマリー（取り消し済みイベントを除外）
async function getDailySummary(date) {
  const events = await getEvents({ date });
  const materials = await getMaterials();
  const matMap = {};
  for (const m of materials) matMap[m.id] = m;
  const reversedIds = await getReversedEventIds();
  const active = events.filter(e => !reversedIds.has(e.eventId) && e.type !== 'reversal');

  return {
    date,
    receipts: active.filter(e => e.type === 'receipt'),
    mixings: active.filter(e => e.type === 'mixing'),
    usages: active.filter(e => e.type === 'usage'),
    materialMap: matMap
  };
}

// 直近のロット番号を取得（材料別、新しい順、最大5件）
async function getRecentLotNumbers(materialId) {
  const events = await getEvents({ materialId });
  const reversedIds = await getReversedEventIds();
  const seen = new Map(); // lotNumber -> latest timestamp
  for (const e of events) {
    if (reversedIds.has(e.eventId)) continue;
    if (!e.lotNumber) continue;
    const existing = seen.get(e.lotNumber);
    if (!existing || e.timestamp > existing) {
      seen.set(e.lotNumber, e.timestamp);
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, 5)
    .map(([lot]) => lot);
}

// 全データをJSONエクスポート
async function exportAllData() {
  const materials = await getMaterials();
  const events = await getEvents();
  return {
    exportDate: new Date().toISOString(),
    appVersion: '0.1.0-beta',
    materials,
    events
  };
}
