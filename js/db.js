// ============================================
// IndexedDB データ層 — イベントソーシング方式
// ============================================

const DB_NAME = 'MaterialApp';
const DB_VERSION = 2;

// 径間マスタ（そうろう橋・固定）
const SPANS = [
  'A1-P1', 'P1-P2', 'P2-P3', 'P3-P4',
  'P4-P5', 'P5-P6', 'P6-P7', 'P7-P8',
  'P13-P14', 'P14-P15', 'P15-P16', 'P16-P17'
];

// 工程マスタ
const PROCESSES = [
  'プライマー塗布',
  'パテ整形',
  '含浸接着樹脂（下塗り）',
  '炭素繊維シート貼付',
  '含浸接着樹脂（上塗り）'
];

// 材料マスタ（仮データ — 後日ユーザーが標準使用量等を提供）
const DEFAULT_MATERIALS = [
  {
    id: 'primer',
    name: 'エポサームプライマー',
    unit: 'セット',
    packSize: 1,
    isTwoComponent: true,
    mixRatio: { base: 4, hardener: 1 },
    mixRatioUnit: '重量比',
    standardUsage: null,  // kg/㎡ — 後日入力
    defaultMargin: 1.1,
    potLife: 40,  // 可使時間（分）— 仮値、後日確認
    hazardClass: null,    // 後日入力
    designatedQty: null
  },
  {
    id: 'putty',
    name: 'エポサームパテ',
    unit: 'セット',
    packSize: 1,
    isTwoComponent: true,
    mixRatio: { base: 2, hardener: 1 },
    mixRatioUnit: '重量比',
    standardUsage: null,
    defaultMargin: 1.1,
    potLife: 30,  // 仮値
    hazardClass: null,
    designatedQty: null
  },
  {
    id: 'resin',
    name: 'エポサームレジン',
    unit: 'セット',
    packSize: 1,
    isTwoComponent: true,
    mixRatio: { base: 2, hardener: 1 },
    mixRatioUnit: '重量比',
    standardUsage: null,
    defaultMargin: 1.1,
    potLife: 50,  // 仮値
    hazardClass: null,
    designatedQty: null
  },
  {
    id: 'cf_sheet',
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
  }
];

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
  for (const m of DEFAULT_MATERIALS) {
    store.put(m);
  }
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
    req.onsuccess = () => resolve(req.result);
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

// 気温記録イベント
async function addTemperatureEvent(temperature, notes) {
  return addEvent({
    type: 'temperature',
    temperature: Number(temperature),
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

// 在庫計算（搬入 − 使用 = 残数）
async function getInventory() {
  const materials = await getMaterials();
  const receipts = await getEvents({ type: 'receipt' });
  const usages = await getEvents({ type: 'usage' });

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
    inventory[r.materialId].totalReceived += r.quantity;
    if (!inventory[r.materialId].lots[r.lotNumber]) {
      inventory[r.materialId].lots[r.lotNumber] = { received: 0, used: 0 };
    }
    inventory[r.materialId].lots[r.lotNumber].received += r.quantity;
  }

  for (const u of usages) {
    if (!inventory[u.materialId]) continue;
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

// 日次サマリー
async function getDailySummary(date) {
  const events = await getEvents({ date });
  const materials = await getMaterials();
  const matMap = {};
  for (const m of materials) matMap[m.id] = m;

  return {
    date,
    receipts: events.filter(e => e.type === 'receipt'),
    mixings: events.filter(e => e.type === 'mixing'),
    usages: events.filter(e => e.type === 'usage'),
    materialMap: matMap
  };
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
