// ============================================
// 材料管理アプリ — メインロジック v2
// ============================================

let currentScreen = 'home';
let prevScreen = null;
let wizardState = {};

// ============================================
// 初期化
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  await initMaterials();
  renderHome();
  setupNav();
});

// ============================================
// ナビゲーション
// ============================================

function setupNav() {
  document.querySelectorAll('#tab-bar .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.screen);
    });
  });
}

function navigateTo(screen) {
  prevScreen = currentScreen;
  currentScreen = screen;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + screen);
  if (el) el.classList.add('active');

  // タブのアクティブ状態
  document.querySelectorAll('#tab-bar .tab').forEach(b => b.classList.remove('active'));
  const tab = document.querySelector(`#tab-bar .tab[data-screen="${screen}"]`);
  if (tab) tab.classList.add('active');

  // ヘッダー更新
  updateHeader(screen);

  // 画面描画
  switch (screen) {
    case 'home': renderHome(); break;
    case 'receipt': renderReceipt(); break;
    case 'mixing': renderMixing(); break;
    case 'usage': renderUsage(); break;
    case 'inventory': renderInventory(); break;
    case 'field': renderField(); break;
    case 'log': renderLog(); break;
    case 'report': renderReport(); break;
  }
}

function updateHeader(screen) {
  const titles = {
    home: '材料管理',
    receipt: '搬入登録',
    mixing: '混合記録',
    usage: '使用記録',
    inventory: '在庫',
    field: '現場',
    log: 'ログ',
    report: '日報'
  };

  document.getElementById('header-title').textContent = titles[screen] || '材料管理';

  const backBtn = document.getElementById('header-back');
  const subtitle = document.getElementById('header-subtitle');

  if (screen === 'home') {
    backBtn.classList.add('hidden');
    subtitle.style.display = '';
  } else {
    backBtn.classList.remove('hidden');
    subtitle.style.display = 'none';
  }
}

function goBack() {
  navigateTo('home');
}

// ============================================
// トースト
// ============================================

function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ============================================
// ホーム画面
// ============================================

async function renderHome() {
  const today = new Date().toISOString().slice(0, 10);
  const summary = await getDailySummary(today);
  const inventory = await getInventory();
  const totalRemaining = Object.values(inventory).reduce((s, v) => s + v.remaining, 0);

  const el = document.getElementById('screen-home');
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-number">${summary.receipts.length}</div>
        <div class="stat-label">搬入</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${summary.mixings.length}</div>
        <div class="stat-label">混合</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${summary.usages.length}</div>
        <div class="stat-label">使用</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-number">${totalRemaining}</div>
        <div class="stat-label">在庫合計</div>
      </div>
    </div>

    <div class="section-title">アクション</div>
    <div class="action-list">
      <button class="action-item" onclick="navigateTo('receipt')">
        <span class="action-icon blue">+</span>
        <span class="action-label">搬入登録</span>
        <span class="action-chevron">›</span>
      </button>
      <button class="action-item" onclick="navigateTo('mixing')">
        <span class="action-icon cyan">⚗</span>
        <span class="action-label">混合記録</span>
        <span class="action-chevron">›</span>
      </button>
      <button class="action-item" onclick="navigateTo('usage')">
        <span class="action-icon green">−</span>
        <span class="action-label">使用記録</span>
        <span class="action-chevron">›</span>
      </button>
      <button class="action-item" onclick="navigateTo('report')">
        <span class="action-icon purple">▤</span>
        <span class="action-label">日報作成</span>
        <span class="action-chevron">›</span>
      </button>
    </div>

    ${renderHomeWidgets(summary, inventory)}
  `;
}

function renderHomeWidgets(summary, inventory) {
  let html = '';

  // --- 直近の操作ウィジェット ---
  const allEvents = [...summary.receipts, ...summary.mixings, ...summary.usages];
  allEvents.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  const recent = allEvents.slice(0, 5);

  if (recent.length > 0) {
    html += '<div class="section-title mt-24">今日のアクティビティ</div><div class="widget">';
    for (const ev of recent) {
      const mat = summary.materialMap[ev.materialId];
      const matName = mat ? mat.name.replace('エポサーム', '') : ev.materialId;
      const time = ev.timestamp ? new Date(ev.timestamp).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';

      let icon = '', label = '', detail = '';
      switch (ev.type) {
        case 'receipt':
          icon = '+'; label = '搬入';
          detail = `${matName} ${ev.quantity}${mat?.unit || ''} ${ev.lotNumber}`;
          break;
        case 'mixing':
          icon = '⚗'; label = '混合';
          detail = `${matName} → ${ev.result} [${ev.spanId}]`;
          break;
        case 'usage':
          icon = '−'; label = '使用';
          detail = `${matName} ${ev.quantity}${mat?.unit || ''} [${ev.spanId}]`;
          break;
      }

      html += `
        <div class="widget-activity">
          <div class="widget-activity-icon ${ev.type}">${icon}</div>
          <div class="widget-activity-body">
            <div class="widget-activity-detail">${detail}</div>
            <div class="widget-activity-time">${time}</div>
          </div>
        </div>
      `;
    }
    html += '</div>';
  }

  return html;
}

// ============================================
// 搬入登録
// ============================================

async function renderReceipt() {
  wizardState = { step: 1, materialId: null, lotNumber: '', quantity: 1 };
  const materials = await getMaterials();

  const el = document.getElementById('screen-receipt');
  el.innerHTML = `
    <div class="progress-bar">
      <div class="progress-segment current" id="rp1"></div>
      <div class="progress-segment" id="rp2"></div>
      <div class="progress-segment" id="rp3"></div>
    </div>

    <div class="wizard-step active" id="rs1">
      <div class="step-label"><span class="step-number">1</span>材料を選択</div>
      <div class="select-grid">
        ${materials.map(m => `
          <button class="select-btn" onclick="receiptSelectMat('${m.id}', this)">
            ${m.name.replace('エポサーム', '')}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="wizard-step" id="rs2">
      <div class="step-label"><span class="step-number">2</span>数量・ロット番号</div>
      <div class="card card-padded">
        <div class="form-group">
          <label class="form-label">数量</label>
          <div class="stepper">
            <button class="stepper-btn" onclick="receiptQty(-1)">−</button>
            <div class="stepper-value">
              <div class="stepper-number" id="r-qty">1</div>
              <div class="stepper-unit" id="r-unit">セット</div>
            </div>
            <button class="stepper-btn" onclick="receiptQty(1)">+</button>
          </div>
        </div>
      </div>
      <div class="card card-padded">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px">
          <label class="form-label" style="margin-bottom:0">ロット番号</label>
          <button class="btn-same-lot" onclick="receiptFillAllLots()" id="r-same-btn" style="display:none">全て同じ</button>
        </div>
        <div id="r-lot-fields">
          <div class="form-group">
            <input type="text" class="form-input form-input-lot" data-lot-index="0" placeholder="ロット番号 #1" oninput="receiptLotInput()">
          </div>
        </div>
      </div>
      <button class="btn btn-accent mt-16" onclick="receiptToConfirm()">確認へ</button>
    </div>

    <div class="wizard-step" id="rs3">
      <div class="step-label"><span class="step-number">3</span>確認</div>
      <div class="confirm-card" id="r-confirm"></div>
      <button class="btn btn-success" onclick="receiptSubmit()">登録する</button>
      <button class="btn btn-ghost mt-8" onclick="renderReceipt()">やり直す</button>
    </div>
  `;
}

async function receiptSelectMat(id, btn) {
  wizardState.materialId = id;
  document.querySelectorAll('#rs1 .select-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  const mats = await getMaterials();
  const mat = mats.find(m => m.id === id);

  setTimeout(() => {
    wizardAdvance('rs', 'rp', 1, 2);
    if (mat) document.getElementById('r-unit').textContent = mat.unit;
  }, 180);
}

function receiptQty(d) {
  wizardState.quantity = Math.max(1, wizardState.quantity + d);
  document.getElementById('r-qty').textContent = wizardState.quantity;
  receiptUpdateLotFields();
}

function receiptUpdateLotFields() {
  const container = document.getElementById('r-lot-fields');
  const qty = wizardState.quantity;
  const current = container.querySelectorAll('input[data-lot-index]');
  const values = [];
  current.forEach(inp => values.push(inp.value));

  let html = '';
  for (let i = 0; i < qty; i++) {
    const val = values[i] || '';
    html += `<div class="form-group" style="margin-bottom:${i < qty - 1 ? '10' : '0'}px">
      <input type="text" class="form-input form-input-lot" data-lot-index="${i}"
             placeholder="ロット番号 #${i + 1}" value="${val}" oninput="receiptLotInput()">
    </div>`;
  }
  container.innerHTML = html;

  // 「全て同じ」ボタンの表示切替
  const sameBtn = document.getElementById('r-same-btn');
  if (sameBtn) sameBtn.style.display = qty > 1 ? '' : 'none';
}

function receiptLotInput() {
  // 1番目の入力があれば「全て同じ」ボタンを有効化
}

function receiptFillAllLots() {
  const fields = document.querySelectorAll('#r-lot-fields input[data-lot-index]');
  if (fields.length === 0) return;
  const firstVal = fields[0].value.trim();
  if (!firstVal) { showToast('1番目のロット番号を入力してください'); return; }
  fields.forEach(f => f.value = firstVal);
  showToast('全てのロットを統一しました');
}

function receiptGetLots() {
  const fields = document.querySelectorAll('#r-lot-fields input[data-lot-index]');
  const lots = [];
  fields.forEach(f => lots.push(f.value.trim().toUpperCase()));
  return lots;
}

async function receiptToConfirm() {
  const lots = receiptGetLots();
  const empty = lots.findIndex(l => !l);
  if (empty >= 0) { showToast(`ロット番号 #${empty + 1} を入力してください`); return; }

  wizardState.lots = lots;

  const mats = await getMaterials();
  const mat = mats.find(m => m.id === wizardState.materialId);

  // ロットごとに集計（同じロットはまとめる）
  const lotCount = {};
  lots.forEach(l => { lotCount[l] = (lotCount[l] || 0) + 1; });

  let lotHtml = '';
  for (const [lot, count] of Object.entries(lotCount)) {
    lotHtml += `<div class="confirm-row"><span class="confirm-row-label">${lot}</span><span class="confirm-row-value">${count} ${mat.unit}</span></div>`;
  }

  document.getElementById('r-confirm').innerHTML = `
    <div class="confirm-title">登録内容</div>
    <div class="confirm-row"><span class="confirm-row-label">材料</span><span class="confirm-row-value">${mat.name}</span></div>
    <div class="confirm-row"><span class="confirm-row-label">合計数量</span><span class="confirm-row-value">${wizardState.quantity} ${mat.unit}</span></div>
    <div style="border-top:0.5px solid var(--separator); margin-top:8px; padding-top:8px">
      <div style="font-size:12px; color:var(--text-sub); font-weight:600; letter-spacing:0.5px; margin-bottom:8px;">ロット内訳</div>
      ${lotHtml}
    </div>
  `;

  wizardAdvance('rs', 'rp', 2, 3);
}

async function receiptSubmit() {
  // ロットごとにまとめてイベントを登録
  const lotCount = {};
  wizardState.lots.forEach(l => { lotCount[l] = (lotCount[l] || 0) + 1; });

  for (const [lot, count] of Object.entries(lotCount)) {
    await addReceiptEvent(wizardState.materialId, lot, count, '足場内');
  }
  showToast(`${wizardState.quantity}件の搬入を登録しました`);
  navigateTo('home');
}

// ============================================
// 混合記録
// ============================================

async function renderMixing() {
  wizardState = { step: 1, materialId: null, lotNumber: '', baseWeight: '', hardenerWeight: '', spanId: null, process: null };
  const materials = await getMaterials();
  const twoComp = materials.filter(m => m.isTwoComponent);

  const el = document.getElementById('screen-mixing');
  el.innerHTML = `
    <div class="progress-bar">
      <div class="progress-segment current" id="mp1"></div>
      <div class="progress-segment" id="mp2"></div>
      <div class="progress-segment" id="mp3"></div>
      <div class="progress-segment" id="mp4"></div>
    </div>

    <div class="wizard-step active" id="ms1">
      <div class="step-label"><span class="step-number">1</span>材料を選択</div>
      <div class="select-grid">
        ${twoComp.map(m => `
          <button class="select-btn" onclick="mixSelectMat('${m.id}', this)">
            ${m.name.replace('エポサーム', '')}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="wizard-step" id="ms2">
      <div class="step-label"><span class="step-number">2</span>径間を選択</div>
      <div class="select-grid">
        ${SPANS.map(s => `
          <button class="select-btn" style="font-size:14px" onclick="mixSelectSpan('${s}', this)">${s}</button>
        `).join('')}
      </div>
    </div>

    <div class="wizard-step" id="ms3">
      <div class="step-label"><span class="step-number">3</span>工程を選択</div>
      <div class="select-list">
        ${PROCESSES.map(p => `
          <button class="select-btn" onclick="mixSelectProcess('${p}', this)">${p}</button>
        `).join('')}
      </div>
    </div>

    <div class="wizard-step" id="ms4">
      <div class="step-label"><span class="step-number">4</span>計量値を入力</div>
      <div class="card card-padded">
        <div class="form-group">
          <label class="form-label">ロット番号</label>
          <input type="text" class="form-input form-input-lot" id="m-lot" placeholder="ロット番号">
        </div>
        <div class="form-group">
          <label class="form-label">主剤 (g)</label>
          <input type="number" inputmode="decimal" class="form-input form-input-number" id="m-base" placeholder="0" oninput="mixCheck()">
        </div>
        <div class="form-group">
          <label class="form-label">硬化剤 (g)</label>
          <input type="number" inputmode="decimal" class="form-input form-input-number" id="m-hard" placeholder="0" oninput="mixCheck()">
        </div>
        <div id="mix-result"></div>
      </div>
      <button class="btn btn-success" id="mix-submit" onclick="mixSubmit()" disabled>記録する</button>
      <button class="btn btn-ghost mt-8" onclick="renderMixing()">やり直す</button>
    </div>
  `;
}

async function mixSelectMat(id, btn) {
  wizardState.materialId = id;
  document.querySelectorAll('#ms1 .select-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  setTimeout(() => wizardAdvance('ms', 'mp', 1, 2), 180);
}

function mixSelectSpan(span, btn) {
  wizardState.spanId = span;
  document.querySelectorAll('#ms2 .select-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  setTimeout(() => wizardAdvance('ms', 'mp', 2, 3), 180);
}

function mixSelectProcess(proc, btn) {
  wizardState.process = proc;
  document.querySelectorAll('#ms3 .select-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  setTimeout(() => wizardAdvance('ms', 'mp', 3, 4), 180);
}

async function mixCheck() {
  const base = parseFloat(document.getElementById('m-base').value);
  const hard = parseFloat(document.getElementById('m-hard').value);

  if (!base || !hard || hard === 0) {
    document.getElementById('mix-result').innerHTML = '';
    document.getElementById('mix-submit').disabled = true;
    return;
  }

  const mats = await getMaterials();
  const mat = mats.find(m => m.id === wizardState.materialId);
  const target = mat.mixRatio.base / mat.mixRatio.hardener;
  const actual = base / hard;
  const tolerance = 0.1;
  const ok = Math.abs(actual - target) / target <= tolerance;

  document.getElementById('mix-result').innerHTML = `
    <div class="mix-result ${ok ? 'ok' : 'ng'}">
      <div class="mix-result-icon">${ok ? '✓' : '✗'}</div>
      <div class="mix-result-text">${ok ? 'OK' : 'NG — 比率確認'}</div>
      <div class="mix-result-detail">実測 ${actual.toFixed(2)} : 1 ／ 規定 ${target.toFixed(1)} : 1</div>
    </div>
  `;

  wizardState.baseWeight = base;
  wizardState.hardenerWeight = hard;
  wizardState.mixResult = ok ? 'OK' : 'NG';
  document.getElementById('mix-submit').disabled = false;
}

async function mixSubmit() {
  const lot = document.getElementById('m-lot').value.trim().toUpperCase();
  await addMixingEvent(
    wizardState.materialId, lot,
    wizardState.baseWeight, wizardState.hardenerWeight,
    wizardState.spanId, wizardState.process, wizardState.mixResult
  );
  showToast('混合記録を保存しました');

  // 可使時間タイマーを自動起動
  const materials = await getMaterials();
  const mat = materials.find(m => m.id === wizardState.materialId);
  if (mat && mat.potLife) {
    startPotLifeTimer(mat, lot, wizardState.spanId, wizardState.process);
  }

  navigateTo('home');
}

// ============================================
// 使用記録（在庫ベース・ワンタップ方式）
// ============================================

// 作業コンテキスト（セッション中保持）
let usageContext = { spanId: null, process: null };

async function renderUsage() {
  const inventory = await getInventory();
  const el = document.getElementById('screen-usage');

  // コンテキスト未設定なら設定画面を出す
  if (!usageContext.spanId || !usageContext.process) {
    renderUsageContext();
    return;
  }

  // アクティブな材料（残数 > 0のロット）を一覧表示
  let html = `
    <div class="usage-context-bar" onclick="renderUsageContext()">
      <span>${usageContext.spanId}　${usageContext.process}</span>
      <span class="action-chevron">変更 ›</span>
    </div>
  `;

  let hasStock = false;

  for (const [matId, inv] of Object.entries(inventory)) {
    const lots = Object.entries(inv.lots).filter(([_, d]) => d.remaining > 0);
    if (lots.length === 0) continue;
    hasStock = true;

    html += `<div class="section-title mt-16">${inv.material.name.replace('エポサーム', '')}</div>`;

    for (const [lotNumber, data] of lots) {
      html += `
        <div class="usage-lot-card">
          <div class="usage-lot-info">
            <div class="usage-lot-number">${lotNumber}</div>
            <div class="usage-lot-remaining">残 ${data.remaining} ${inv.material.unit}</div>
          </div>
          <div class="usage-lot-actions">
            <button class="usage-empty-btn" onclick="usageMarkEmpty('${matId}', '${lotNumber}', 1, '${inv.material.unit}')">
              空缶
            </button>
            <button class="usage-partial-btn" onclick="usagePartial('${matId}', '${lotNumber}', ${data.remaining}, '${inv.material.unit}')">
              手入力
            </button>
          </div>
        </div>
      `;
    }
  }

  if (!hasStock) {
    html += '<div class="empty-state mt-24"><div class="empty-icon">📦</div><div class="empty-text">在庫がありません<br>搬入登録から材料を追加してください</div></div>';
  }

  el.innerHTML = html;
}

function renderUsageContext() {
  const el = document.getElementById('screen-usage');
  el.innerHTML = `
    <div class="screen-title">作業コンテキスト</div>

    <div class="section-title">径間</div>
    <div class="select-grid mb-16">
      ${SPANS.map(s => `
        <button class="select-btn ${usageContext.spanId === s ? 'selected' : ''}" style="font-size:14px"
                onclick="usageSetSpan('${s}', this)">${s}</button>
      `).join('')}
    </div>

    <div class="section-title">工程</div>
    <div class="select-list mb-16">
      ${PROCESSES.map(p => `
        <button class="select-btn ${usageContext.process === p ? 'selected' : ''}"
                onclick="usageSetProcess('${p}', this)">${p}</button>
      `).join('')}
    </div>

    <button class="btn btn-accent mt-16" id="usage-context-ok" onclick="usageContextDone()"
            ${!usageContext.spanId || !usageContext.process ? 'disabled' : ''}>
      設定して材料一覧へ
    </button>
  `;
}

function usageSetSpan(span, btn) {
  usageContext.spanId = span;
  document.querySelectorAll('#screen-usage .select-grid .select-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  usageCheckContextReady();
}

function usageSetProcess(proc, btn) {
  usageContext.process = proc;
  document.querySelectorAll('#screen-usage .select-list .select-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  usageCheckContextReady();
}

function usageCheckContextReady() {
  const okBtn = document.getElementById('usage-context-ok');
  if (okBtn) okBtn.disabled = !(usageContext.spanId && usageContext.process);
}

function usageContextDone() {
  if (!usageContext.spanId || !usageContext.process) return;
  renderUsage();
}

// 空缶ボタン — ワンタップで1単位使用記録
async function usageMarkEmpty(materialId, lotNumber, quantity, unit) {
  await addUsageEvent(materialId, lotNumber, quantity, usageContext.spanId, usageContext.process);
  showToast(`${lotNumber} × ${quantity}${unit} 使用記録`);
  renderUsage(); // 画面を更新（残数が減る）
}

// 手入力 — モーダルで数量を入力
function usagePartial(materialId, lotNumber, maxQty, unit) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');

  let partialQty = 1;

  content.innerHTML = `
    <div class="modal-handle"></div>
    <div class="confirm-title">使用量を入力</div>
    <div style="text-align:center; margin-bottom:8px; font-size:14px; color:var(--text-sub)">
      ${lotNumber}（残 ${maxQty} ${unit}）
    </div>
    <div class="stepper" style="margin:20px 0">
      <button class="stepper-btn" onclick="usagePartialQty(-1, ${maxQty})">−</button>
      <div class="stepper-value">
        <div class="stepper-number" id="partial-qty">1</div>
        <div class="stepper-unit">${unit}</div>
      </div>
      <button class="stepper-btn" onclick="usagePartialQty(1, ${maxQty})">+</button>
    </div>
    <button class="btn btn-success" onclick="usagePartialSubmit('${materialId}', '${lotNumber}')">記録する</button>
    <button class="btn btn-ghost mt-8" onclick="usagePartialClose()">キャンセル</button>
  `;

  overlay.classList.remove('hidden');

  // モーダルの外側タップで閉じる
  overlay.onclick = (e) => { if (e.target === overlay) usagePartialClose(); };
}

function usagePartialQty(d, max) {
  const el = document.getElementById('partial-qty');
  let val = parseInt(el.textContent) + d;
  val = Math.max(1, Math.min(val, max));
  el.textContent = val;
}

async function usagePartialSubmit(materialId, lotNumber) {
  const qty = parseInt(document.getElementById('partial-qty').textContent);
  await addUsageEvent(materialId, lotNumber, qty, usageContext.spanId, usageContext.process);
  usagePartialClose();
  showToast(`${lotNumber} × ${qty} 使用記録`);
  renderUsage();
}

function usagePartialClose() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ============================================
// 在庫画面
// ============================================

async function renderInventory() {
  const inventory = await getInventory();
  const el = document.getElementById('screen-inventory');

  let html = '<div class="section-title">現在の在庫</div>';

  const entries = Object.entries(inventory);
  if (entries.length === 0) {
    html += '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">データなし</div></div>';
  }

  for (const [id, inv] of entries) {
    const lots = Object.entries(inv.lots);
    const cls = inv.remaining <= 0 ? 'empty' : inv.remaining <= 2 ? 'low' : '';

    html += `
      <div class="inventory-card ${cls}">
        <div class="inv-info">
          <div class="inv-name">${inv.material.name.replace('エポサーム', '')}</div>
          ${lots.length > 0 ? `<div class="inv-lots">
            ${lots.map(([lot, d]) => `${lot}: ${d.remaining}${inv.material.unit}`).join('<br>')}
          </div>` : ''}
        </div>
        <div class="inv-qty">
          <div class="inv-number">${inv.remaining}</div>
          <div class="inv-unit">${inv.material.unit}</div>
        </div>
      </div>
    `;
  }

  html += `<button class="btn btn-glass mt-20" onclick="exportData()">データをエクスポート</button>`;
  el.innerHTML = html;
}

// ============================================
// ログ画面
// ============================================

async function renderLog() {
  const events = await getEvents();
  const materials = await getMaterials();
  const matMap = {};
  for (const m of materials) matMap[m.id] = m;

  const el = document.getElementById('screen-log');
  const sorted = events.sort((a, b) => b.eventId - a.eventId);

  let html = `<div class="section-title">操作ログ（${events.length}件）</div>`;

  if (sorted.length === 0) {
    html += '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">まだ記録がありません</div></div>';
  }

  let lastDate = '';

  for (const ev of sorted.slice(0, 50)) {
    const mat = matMap[ev.materialId];
    const matName = mat ? mat.name.replace('エポサーム', '') : ev.materialId;
    const date = ev.date || '';
    const time = ev.timestamp ? new Date(ev.timestamp).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';

    if (date !== lastDate) {
      html += `<div class="log-date-header">${date}</div>`;
      lastDate = date;
    }

    let content = '';
    const badge = ev.type === 'receipt' ? '搬入' : ev.type === 'mixing' ? '混合' : '使用';

    switch (ev.type) {
      case 'receipt':
        content = `${matName} ${ev.quantity}${mat?.unit || ''} — ロット: ${ev.lotNumber}`;
        break;
      case 'mixing':
        content = `${matName} 主剤${ev.baseWeight}g / 硬化剤${ev.hardenerWeight}g → ${ev.result}　[${ev.spanId} ${ev.process}]`;
        break;
      case 'usage':
        content = `${matName} ${ev.quantity}${mat?.unit || ''}　[${ev.spanId} ${ev.process}]`;
        break;
    }

    html += `
      <div class="log-entry">
        <div class="log-entry-header">
          <span class="log-badge ${ev.type}">${badge}</span>
          <span class="log-time">${time}</span>
        </div>
        <div class="log-body">${content}</div>
      </div>
    `;
  }

  el.innerHTML = html;
}

// ============================================
// 日報
// ============================================

async function renderReport() {
  const today = new Date().toISOString().slice(0, 10);
  const summary = await getDailySummary(today);
  const inventory = await getInventory();

  const el = document.getElementById('screen-report');

  let html = `<div class="screen-title">${today.replace(/-/g, '.')}<br><span class="gradient-text">日報</span></div>`;

  // 搬入
  html += '<div class="report-group"><div class="report-group-title">搬入</div><div class="report-card">';
  if (summary.receipts.length === 0) {
    html += '<div class="report-row"><span class="report-row-label">なし</span></div>';
  }
  for (const r of summary.receipts) {
    const mat = summary.materialMap[r.materialId];
    html += `<div class="report-row"><span class="report-row-label">${mat?.name.replace('エポサーム', '') || r.materialId}</span><span class="report-row-value">${r.quantity}${mat?.unit || ''} (${r.lotNumber})</span></div>`;
  }
  html += '</div></div>';

  // 混合
  html += '<div class="report-group"><div class="report-group-title">混合</div><div class="report-card">';
  if (summary.mixings.length === 0) {
    html += '<div class="report-row"><span class="report-row-label">なし</span></div>';
  }
  for (const m of summary.mixings) {
    const mat = summary.materialMap[m.materialId];
    html += `<div class="report-row"><span class="report-row-label">${mat?.name.replace('エポサーム', '') || m.materialId}</span><span class="report-row-value">${m.result} ${m.spanId}</span></div>`;
  }
  html += '</div></div>';

  // 使用
  html += '<div class="report-group"><div class="report-group-title">使用</div><div class="report-card">';
  if (summary.usages.length === 0) {
    html += '<div class="report-row"><span class="report-row-label">なし</span></div>';
  }
  for (const u of summary.usages) {
    const mat = summary.materialMap[u.materialId];
    html += `<div class="report-row"><span class="report-row-label">${mat?.name.replace('エポサーム', '') || u.materialId}</span><span class="report-row-value">${u.quantity}${mat?.unit || ''} ${u.spanId}</span></div>`;
  }
  html += '</div></div>';

  // 在庫
  html += '<div class="report-group"><div class="report-group-title">在庫残数</div><div class="report-card">';
  for (const [id, inv] of Object.entries(inventory)) {
    html += `<div class="report-row"><span class="report-row-label">${inv.material.name.replace('エポサーム', '')}</span><span class="report-row-value">${inv.remaining} ${inv.material.unit}</span></div>`;
  }
  html += '</div></div>';

  html += `<button class="btn btn-accent" onclick="copyReport()">テキストをコピー</button>`;
  html += `<button class="btn btn-ghost mt-8" onclick="navigateTo('home')">戻る</button>`;

  el.innerHTML = html;
}

async function copyReport() {
  const today = new Date().toISOString().slice(0, 10);
  const summary = await getDailySummary(today);
  const inventory = await getInventory();

  let text = `【材料日報】${today}\n\n`;

  text += '■ 搬入\n';
  for (const r of summary.receipts) {
    const mat = summary.materialMap[r.materialId];
    text += `  ${mat?.name || r.materialId} ${r.quantity}${mat?.unit || ''} ロット:${r.lotNumber}\n`;
  }
  if (summary.receipts.length === 0) text += '  なし\n';

  text += '\n■ 混合\n';
  for (const m of summary.mixings) {
    const mat = summary.materialMap[m.materialId];
    text += `  ${mat?.name || m.materialId} ${m.spanId} ${m.process} → ${m.result}\n`;
  }
  if (summary.mixings.length === 0) text += '  なし\n';

  text += '\n■ 使用\n';
  for (const u of summary.usages) {
    const mat = summary.materialMap[u.materialId];
    text += `  ${mat?.name || u.materialId} ${u.quantity}${mat?.unit || ''} ${u.spanId} ${u.process}\n`;
  }
  if (summary.usages.length === 0) text += '  なし\n';

  text += '\n■ 在庫残数\n';
  for (const [id, inv] of Object.entries(inventory)) {
    text += `  ${inv.material.name} ${inv.remaining}${inv.material.unit}\n`;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('コピーしました');
  } catch {
    showToast('コピーに失敗しました');
  }
}

// ============================================
// 現場タブ（気温記録 + 可使時間タイマー）
// ============================================

let fieldTemperature = 20;
let activeTimers = []; // { id, material, lotNumber, spanId, process, startTime, potLifeMin }
let timerInterval = null;

function startPotLifeTimer(material, lotNumber, spanId, process) {
  const timer = {
    id: Date.now(),
    material,
    lotNumber,
    spanId,
    process,
    startTime: Date.now(),
    potLifeMin: material.potLife
  };
  activeTimers.push(timer);
  ensureTimerInterval();
}

function ensureTimerInterval() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    if (currentScreen === 'field') {
      renderTimerSection();
    }
    // 期限切れチェック
    for (const t of activeTimers) {
      const elapsed = (Date.now() - t.startTime) / 1000 / 60;
      const remaining = t.potLifeMin - elapsed;
      if (remaining <= 0 && !t.expired) {
        t.expired = true;
        showToast(`⚠ ${t.material.name.replace('エポサーム', '')} 可使時間超過！`);
      }
    }
    if (activeTimers.every(t => t.expired || t.dismissed)) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }, 1000);
}

function dismissTimer(timerId) {
  activeTimers = activeTimers.filter(t => t.id !== timerId);
  if (activeTimers.length === 0 && timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (currentScreen === 'field') renderField();
}

async function renderField() {
  const el = document.getElementById('screen-field');
  const today = new Date().toISOString().slice(0, 10);
  const tempEvents = (await getEvents({ type: 'temperature' })).filter(e => e.date === today);

  el.innerHTML = `
    ${renderTimerSectionHTML()}

    <div class="section-title ${activeTimers.length > 0 ? 'mt-24' : ''}">気温記録</div>
    <div class="glass-card">
      <div class="field-temp-input">
        <div class="stepper">
          <button class="stepper-btn" onclick="fieldTempChange(-1)">−</button>
          <div class="stepper-value">
            <div class="stepper-number" id="field-temp-display">${fieldTemperature}</div>
            <div class="stepper-unit">℃</div>
          </div>
          <button class="stepper-btn" onclick="fieldTempChange(1)">+</button>
        </div>
        <div class="field-temp-fine">
          <button class="field-fine-btn" onclick="fieldTempChange(-0.5)">-0.5</button>
          <button class="field-fine-btn" onclick="fieldTempChange(-5)">-5</button>
          <button class="field-fine-btn" onclick="fieldTempChange(5)">+5</button>
          <button class="field-fine-btn" onclick="fieldTempChange(0.5)">+0.5</button>
        </div>
      </div>
      <button class="btn btn-accent mt-16" onclick="recordTemperature()" style="width:100%">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-3px;margin-right:6px"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>
        気温を記録
      </button>
    </div>

    ${tempEvents.length > 0 ? `
      <div class="section-title mt-24">今日の記録</div>
      <div class="glass-card">
        ${tempEvents.map(e => {
          const time = new Date(e.timestamp).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
          return `<div class="field-temp-row">
            <span class="field-temp-time">${time}</span>
            <span class="field-temp-val">${e.temperature}℃</span>
            ${e.notes ? `<span class="field-temp-note">${e.notes}</span>` : ''}
          </div>`;
        }).join('')}
      </div>
    ` : ''}
  `;
}

function renderTimerSectionHTML() {
  const live = activeTimers.filter(t => !t.dismissed);
  if (live.length === 0) return '';

  let html = '<div class="section-title">可使時間タイマー</div>';
  for (const t of live) {
    const elapsed = (Date.now() - t.startTime) / 1000 / 60;
    const remaining = Math.max(0, t.potLifeMin - elapsed);
    const pct = Math.min(100, (elapsed / t.potLifeMin) * 100);
    const min = Math.floor(remaining);
    const sec = Math.floor((remaining - min) * 60);
    const timeStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    let urgency = 'safe';
    if (remaining <= 0) urgency = 'expired';
    else if (remaining <= 5) urgency = 'critical';
    else if (remaining <= 10) urgency = 'warning';

    const matName = t.material.name.replace('エポサーム', '');

    html += `
      <div class="timer-card timer-${urgency}" id="timer-${t.id}">
        <div class="timer-header">
          <span class="timer-mat">${matName}</span>
          <button class="timer-dismiss" onclick="dismissTimer(${t.id})">✕</button>
        </div>
        <div class="timer-countdown">${remaining <= 0 ? '超過' : timeStr}</div>
        <div class="timer-bar-bg">
          <div class="timer-bar-fill timer-bar-${urgency}" style="width:${pct}%"></div>
        </div>
        <div class="timer-meta">
          ${t.lotNumber} ・ ${t.spanId} ・ ${t.process}
        </div>
      </div>
    `;
  }
  return html;
}

function renderTimerSection() {
  const live = activeTimers.filter(t => !t.dismissed);
  for (const t of live) {
    const el = document.getElementById('timer-' + t.id);
    if (!el) continue;

    const elapsed = (Date.now() - t.startTime) / 1000 / 60;
    const remaining = Math.max(0, t.potLifeMin - elapsed);
    const pct = Math.min(100, (elapsed / t.potLifeMin) * 100);
    const min = Math.floor(remaining);
    const sec = Math.floor((remaining - min) * 60);
    const timeStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    let urgency = 'safe';
    if (remaining <= 0) urgency = 'expired';
    else if (remaining <= 5) urgency = 'critical';
    else if (remaining <= 10) urgency = 'warning';

    el.className = `timer-card timer-${urgency}`;
    el.querySelector('.timer-countdown').textContent = remaining <= 0 ? '超過' : timeStr;
    const bar = el.querySelector('.timer-bar-fill');
    bar.style.width = pct + '%';
    bar.className = `timer-bar-fill timer-bar-${urgency}`;
  }
}

function fieldTempChange(delta) {
  fieldTemperature = Math.round((fieldTemperature + delta) * 10) / 10;
  const display = document.getElementById('field-temp-display');
  if (display) display.textContent = fieldTemperature;
}

async function recordTemperature() {
  await addTemperatureEvent(fieldTemperature);
  showToast(`${fieldTemperature}℃ を記録しました`);
  renderField();
}

// ============================================
// ウィザード共通
// ============================================

function wizardAdvance(stepPrefix, progPrefix, from, to) {
  document.getElementById(stepPrefix + from).classList.remove('active');
  document.getElementById(stepPrefix + to).classList.add('active');
  document.getElementById(progPrefix + from).classList.remove('current');
  document.getElementById(progPrefix + from).classList.add('done');
  document.getElementById(progPrefix + to).classList.add('current');
}

// ============================================
// エクスポート
// ============================================

async function exportData() {
  const data = await exportAllData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `material-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('エクスポートしました');
}
