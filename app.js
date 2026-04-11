const DAY_IN_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "shelf-life-manager-v2";
const TEMPLATE_STORAGE_KEY = "shelf-life-templates-v1";
const SCANNER_PREFERENCE_STORAGE_KEY = "scanner-preferred-device-v1";
const ARCHIVE_RETENTION_DAYS = 3;

const categories = [
  { id: "dairy", label: "乳制品", icon: "🥛" },
  { id: "meat", label: "肉类", icon: "🥩" },
  { id: "snack", label: "零食", icon: "🍪" },
  { id: "drink", label: "饮料", icon: "🥤" },
  { id: "grain", label: "粮食", icon: "🍚" },
  { id: "other", label: "其他", icon: "📦" },
];

const quickValues = [3, 7, 10, 15, 30, 60, 90];
const todayIso = formatIsoDate(new Date());

const state = {
  page: "manage",
  filter: "all",
  statusFilters: [],
  categoryFilters: [],
  searchVisible: false,
  filterPanelVisible: false,
  search: "",
  swipedGroupKey: null,
  expandedInfoId: null,
  batches: loadBatches(),
  templates: loadTemplates(),
  scanResult: null,
  pendingAddDraft: null,
  formError: "",
  formWarning: "",
  form: createDefaultForm(),
  scanner: createScannerState(),
  calculator: {
    productionDate: todayIso,
    shelfLifeValue: "",
    shelfLifeUnit: "days",
  },
};

const app = document.querySelector("#app");

function createDefaultForm() {
  return {
    name: "",
    category: "other",
    productionDate: todayIso,
    shelfLifeValue: "",
    shelfLifeUnit: "days",
    barcode: "",
    scanHint: "",
  };
}

function createScannerState() {
  const preferredCameraPreference = loadPreferredScannerPreference();
  return {
    open: false,
    status: "idle",
    message: "",
    devices: [],
    deviceIndex: -1,
    selectedDeviceId: preferredCameraPreference.deviceId,
    preferredDeviceId: preferredCameraPreference.deviceId,
    preferredDeviceLabel: preferredCameraPreference.label,
    devicePickerVisible: false,
    stream: null,
    detector: null,
    controls: null,
    backend: "",
    timerId: null,
  };
}

function parseDateInput(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addMonthsInclusive(date, months) {
  const targetMonth = new Date(date.getFullYear(), date.getMonth() + months, 1);
  targetMonth.setHours(0, 0, 0, 0);
  const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
  monthEnd.setHours(0, 0, 0, 0);
  const clampedDay = Math.min(date.getDate(), monthEnd.getDate());
  const shifted = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), clampedDay);
  shifted.setHours(0, 0, 0, 0);
  return addDays(shifted, -1);
}

function normalizeName(name) {
  return String(name || "").trim().toLocaleLowerCase();
}

function compareName(left, right) {
  try {
    return String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");
  } catch {
    return String(left || "").localeCompare(String(right || ""));
  }
}

function formatIsoDate(date) {
  const value = parseDateInput(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(date) {
  const value = parseDateInput(date);
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
}

function formatCreatedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setHours(0, 0, 0, 0);
  return formatDisplayDate(date);
}

function formatShortDate(date) {
  return formatIsoDate(date).replace(/^\d{4}-/, "");
}

function calculateBatchDates({ productionDate, shelfLifeValue, shelfLifeUnit }) {
  const start = parseDateInput(productionDate);
  const numericValue = Number(shelfLifeValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error("Shelf life must be a positive number");
  }
  const expiryDate = shelfLifeUnit === "months"
    ? addMonthsInclusive(start, numericValue)
    : addDays(start, numericValue - 1);
  const removalDate = addDays(expiryDate, -2);
  return { productionDate: start, expiryDate, removalDate };
}

function getBatchStatus({ removalDate, expiryDate, today = new Date() }) {
  const compareDate = parseDateInput(today);
  const removal = parseDateInput(removalDate);
  const expiry = parseDateInput(expiryDate);
  if (compareDate.getTime() > expiry.getTime()) return "expired";
  if (compareDate.getTime() >= removal.getTime()) return "removeSoon";
  return "active";
}

function daysUntil(date, today = new Date()) {
  return Math.round((parseDateInput(date).getTime() - parseDateInput(today).getTime()) / DAY_IN_MS);
}

function createBatchRecord({ id, name, category, productionDate, shelfLifeValue, shelfLifeUnit, barcode }) {
  const calculated = calculateBatchDates({ productionDate, shelfLifeValue, shelfLifeUnit });
  return {
    id,
    name: String(name).trim(),
    normalizedName: normalizeName(name),
    category,
    productionDate: formatIsoDate(calculated.productionDate),
    removalDate: formatIsoDate(calculated.removalDate),
    expiryDate: formatIsoDate(calculated.expiryDate),
    shelfLifeValue: Number(shelfLifeValue),
    shelfLifeUnit,
    barcode: normalizeBarcode(barcode),
    archived: false,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  };
}

function enrichBatch(batch, today = new Date()) {
  const status = batch.archived
    ? "archived"
    : getBatchStatus({ removalDate: batch.removalDate, expiryDate: batch.expiryDate, today });
  return {
    ...batch,
    status,
    removalCountdown: daysUntil(batch.removalDate, today),
    expiryCountdown: daysUntil(batch.expiryDate, today),
  };
}

function sortBatchRecords(records, sortBy = "urgency", today = new Date()) {
  const statusRank = { expired: 0, removeSoon: 1, active: 2, archived: 3 };
  return [...records].sort((left, right) => {
    if (sortBy === "name") return compareName(left.name, right.name);
    if (sortBy === "createdAt") {
      return String(right.createdAt || "").localeCompare(String(left.createdAt || "")) || compareName(left.name, right.name);
    }
    return (
      statusRank[left.status] - statusRank[right.status] ||
      String(left.removalDate || "9999-12-31").localeCompare(String(right.removalDate || "9999-12-31")) ||
      String(left.expiryDate || "9999-12-31").localeCompare(String(right.expiryDate || "9999-12-31")) ||
      compareName(left.name, right.name)
    );
  });
}

function loadBatches() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.name && item.productionDate && item.removalDate && item.expiryDate);
  } catch {
    return [];
  }
}

function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.barcode && item.name && item.category && item.shelfLifeValue && item.shelfLifeUnit);
  } catch {
    return [];
  }
}

function loadPreferredScannerPreference() {
  try {
    const raw = localStorage.getItem(SCANNER_PREFERENCE_STORAGE_KEY);
    if (!raw) return { deviceId: "", label: "" };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        deviceId: String(parsed.deviceId || ""),
        label: String(parsed.label || ""),
      };
    }
    return { deviceId: String(raw || ""), label: "" };
  } catch {
    return { deviceId: "", label: "" };
  }
}

function savePreferredScannerDevice(deviceId, label = "") {
  try {
    if (!deviceId) {
      localStorage.removeItem(SCANNER_PREFERENCE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SCANNER_PREFERENCE_STORAGE_KEY, JSON.stringify({
      deviceId,
      label,
    }));
  } catch {
    // Ignore storage failures and keep scanning available.
  }
}

function saveBatches() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.batches));
}

function saveTemplates() {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(state.templates));
}

function purgeExpiredArchivedRecords() {
  const now = Date.now();
  const retentionMs = ARCHIVE_RETENTION_DAYS * DAY_IN_MS;
  const nextBatches = state.batches.filter((batch) => {
    if (!batch.archived || !batch.archivedAt) return true;
    const archivedAt = new Date(batch.archivedAt).getTime();
    if (Number.isNaN(archivedAt)) return true;
    return now - archivedAt < retentionMs;
  });

  if (nextBatches.length !== state.batches.length) {
    state.batches = nextBatches;
    saveBatches();
  }
}

function createId() {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBarcode(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function buildScannerConstraints(deviceId) {
  return {
    video: deviceId
      ? {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }
      : {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
    audio: false,
  };
}

function scoreCameraDevice(device) {
  const label = String(device.label || "").toLowerCase();
  let score = 0;
  if (/^camera\s*0$/.test(label)) score += 160;
  if (/^camera\s*[1-9]\d*$/.test(label)) score += 40;
  if (/(back|rear|environment)/.test(label)) score += 100;
  if (/(front|user|selfie)/.test(label)) score -= 120;
  if (/(wide|ultra|0\.5|macro|depth|tele|zoom|periscope|portrait)/.test(label)) score -= 60;
  if (/(main|primary|standard|default)/.test(label)) score += 30;
  return score;
}

function extractCameraNumber(device) {
  const match = String(device.label || "").toLowerCase().match(/camera\s*(\d+)/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]);
}

async function getPreferredBackCameraId() {
  if (!navigator.mediaDevices?.enumerateDevices) return "";
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = devices.filter((device) => device.kind === "videoinput");
  if (!videoInputs.length) return "";

  const numberedCameras = videoInputs
    .map((device) => ({ device, number: extractCameraNumber(device) }))
    .filter((item) => Number.isFinite(item.number))
    .sort((left, right) => left.number - right.number);

  if (numberedCameras.length) {
    return numberedCameras[0].device.deviceId || "";
  }

  const sorted = [...videoInputs].sort((left, right) => scoreCameraDevice(right) - scoreCameraDevice(left));
  return sorted[0]?.deviceId || "";
}

async function loadScannerDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    state.scanner.devices = [];
    state.scanner.deviceIndex = -1;
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.scanner.devices = devices.filter((device) => device.kind === "videoinput");
    state.scanner.deviceIndex = state.scanner.devices.findIndex((device) => device.deviceId === state.scanner.selectedDeviceId);
  } catch {
    state.scanner.devices = [];
    state.scanner.deviceIndex = -1;
  }
}

function resolvePreferredDeviceIdFromDevices(devices) {
  const preferredId = state.scanner.preferredDeviceId || "";
  const preferredLabel = String(state.scanner.preferredDeviceLabel || "").toLowerCase();

  if (preferredId && devices.some((device) => device.deviceId === preferredId)) {
    return preferredId;
  }

  if (preferredLabel) {
    const matchedByLabel = devices.find((device) => String(device.label || "").toLowerCase() === preferredLabel);
    if (matchedByLabel) return matchedByLabel.deviceId;
  }

  return "";
}

async function optimizeScannerTrack(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.getCapabilities || !track.applyConstraints) return;

  try {
    const capabilities = track.getCapabilities();
    const advanced = [];

    if (typeof capabilities.zoom?.min === "number") {
      advanced.push({ zoom: capabilities.zoom.min });
    }

    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
      advanced.push({ focusMode: "continuous" });
    }

    if (advanced.length) {
      await track.applyConstraints({ advanced });
    }
  } catch {
    // Some Android browsers expose capabilities but reject constraints; ignore and continue.
  }
}

function findTemplateByBarcode(barcode) {
  const normalized = normalizeBarcode(barcode);
  return state.templates.find((item) => item.barcode === normalized) || null;
}

function upsertTemplate(template) {
  const barcode = normalizeBarcode(template.barcode);
  if (!barcode) return;
  const nextTemplate = {
    barcode,
    name: String(template.name || "").trim(),
    category: template.category,
    shelfLifeValue: Number(template.shelfLifeValue),
    shelfLifeUnit: template.shelfLifeUnit,
    updatedAt: new Date().toISOString(),
  };
  const existingIndex = state.templates.findIndex((item) => item.barcode === barcode);
  if (existingIndex >= 0) {
    state.templates.splice(existingIndex, 1, nextTemplate);
  } else {
    state.templates.unshift(nextTemplate);
  }
  saveTemplates();
}

function resetScanner({ keepMessage = false } = {}) {
  const preferredCameraPreference = {
    deviceId: state.scanner.preferredDeviceId || loadPreferredScannerPreference().deviceId,
    label: state.scanner.preferredDeviceLabel || loadPreferredScannerPreference().label,
  };
  if (state.scanner.timerId) {
    clearTimeout(state.scanner.timerId);
  }
  if (state.scanner.controls?.stop) {
    state.scanner.controls.stop();
  }
  if (state.scanner.stream) {
    state.scanner.stream.getTracks().forEach((track) => track.stop());
  }
  state.scanner = {
    ...createScannerState(),
    selectedDeviceId: preferredCameraPreference.deviceId,
    preferredDeviceId: preferredCameraPreference.deviceId,
    preferredDeviceLabel: preferredCameraPreference.label,
    message: keepMessage ? state.scanner.message : "",
  };
}

function clearScanResult() {
  state.scanResult = null;
}

function buildAddDraftFromScanResult() {
  const { barcode, template } = state.scanResult || {};
  if (!barcode) return null;
  if (template) {
    return {
      barcode,
      name: template.name,
      category: template.category,
      shelfLifeValue: String(template.shelfLifeValue),
      shelfLifeUnit: template.shelfLifeUnit,
      scanHint: `已识别条码 ${barcode}，已自动带出商品模板。`,
    };
  }
  return {
    barcode,
    name: "",
    category: "other",
    shelfLifeValue: "",
    shelfLifeUnit: "days",
    scanHint: `已识别条码 ${barcode}，未找到模板，请补充商品信息。保存后会自动记住这个商品。`,
  };
}

function openAddPage({ usePendingDraft = false } = {}) {
  resetScanner();
  state.page = "add";
  state.formError = "";
  state.formWarning = "";
  if (usePendingDraft && state.pendingAddDraft) {
    state.form = {
      ...createDefaultForm(),
      ...state.pendingAddDraft,
      productionDate: state.form.productionDate || todayIso,
    };
    state.pendingAddDraft = null;
  }
  render();
}

function applyTemplateToForm(template, barcode) {
  state.form = {
    ...state.form,
    barcode,
    name: template.name,
    category: template.category,
    shelfLifeValue: String(template.shelfLifeValue),
    shelfLifeUnit: template.shelfLifeUnit,
    scanHint: `已识别条码 ${barcode}，已自动带出商品模板。`,
  };
}

function applyBarcodeResult(barcode) {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return;
  state.scanResult = {
    barcode: normalized,
    template: findTemplateByBarcode(normalized),
    records: getRecordsByBarcode(normalized),
    view: "records",
  };
  state.formError = "";
  resetScanner();
  render();
}

function getRecordsByBarcode(barcode) {
  const normalized = normalizeBarcode(barcode);
  return state.batches
    .filter((batch) => normalizeBarcode(batch.barcode) === normalized && !batch.archived)
    .map((batch) => enrichBatch(batch, new Date()))
    .sort((left, right) => left.expiryDate.localeCompare(right.expiryDate) || String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function refreshScanResultRecords() {
  if (!state.scanResult?.barcode) return;
  const nextRecords = getRecordsByBarcode(state.scanResult.barcode);
  state.scanResult = {
    ...state.scanResult,
    records: nextRecords,
  };
}

function goToAddPageWithScanResult() {
  state.pendingAddDraft = buildAddDraftFromScanResult();
  state.page = "add";
  clearScanResult();
  openAddPage({ usePendingDraft: true });
}

function hasDuplicateBatch({ name, productionDate, barcode }) {
  const normalizedBarcode = normalizeBarcode(barcode);
  const normalizedName = normalizeName(name);
  return state.batches.some((batch) => {
    if (batch.archived) return false;
    if (batch.productionDate !== productionDate) return false;
    const batchBarcode = normalizeBarcode(batch.barcode);
    if (normalizedBarcode && batchBarcode) {
      return batchBarcode === normalizedBarcode;
    }
    return normalizeName(batch.name) === normalizedName;
  });
}

function getCategoryMeta(categoryId) {
  return categories.find((item) => item.id === categoryId) || categories[categories.length - 1];
}

function getCounts() {
  const activeBatches = state.batches.filter((batch) => !batch.archived);
  const removeSoon = activeBatches.filter((batch) => batch.removalDate <= todayIso && batch.expiryDate >= todayIso).length;
  const expired = activeBatches.filter((batch) => batch.expiryDate < todayIso).length;
  return {
    groupCount: activeBatches.length,
    activeBatchCount: activeBatches.length,
    removeSoon,
    expired,
  };
}

function getVisibleBatches() {
  const today = new Date();
  const normalizedSearch = state.search.trim();
  const archivedView = state.statusFilters.includes("archived");
  const records = state.batches
    .map((batch) => enrichBatch(batch, today))
    .filter((batch) => {
      if (archivedView) {
        if (!batch.archived) return false;
      } else if (batch.archived) {
        return false;
      }
      if (state.categoryFilters.length && !state.categoryFilters.includes(batch.category)) return false;
      if (normalizedSearch) {
        const matchedName = batch.name.includes(normalizedSearch);
        const matchedBarcode = normalizeBarcode(batch.barcode).includes(normalizeBarcode(normalizedSearch));
        if (!matchedName && !matchedBarcode) return false;
      }
      if (!archivedView) {
        if (state.filter === "attention" && batch.status === "active") return false;
        const extraStatusFilters = state.statusFilters.filter((item) => item !== "archived");
        if (extraStatusFilters.length && !extraStatusFilters.includes(batch.status)) return false;
      }
      return true;
    });
  return sortBatchRecords(records, archivedView || state.filter === "all" ? "createdAt" : "urgency", today);
}

function getPreview(formState) {
  if (!formState.productionDate || !formState.shelfLifeValue) return null;
  try {
    return calculateBatchDates({
      productionDate: formState.productionDate,
      shelfLifeValue: Number(formState.shelfLifeValue),
      shelfLifeUnit: formState.shelfLifeUnit,
    });
  } catch {
    return null;
  }
}

function render() {
  let counts;
  let records;
  try {
    counts = getCounts();
    records = getVisibleBatches();
  } catch (error) {
    console.error("Render failed:", error);
    localStorage.removeItem(STORAGE_KEY);
    state.batches = [];
    counts = getCounts();
    records = getVisibleBatches();
  }
  const pageContent = state.page === "manage"
    ? renderManagePage(counts, records)
    : state.page === "add"
      ? renderAddPage()
      : renderCalculatorPage();
  app.innerHTML = `
    <div class="page">
      ${pageContent}
      ${state.page === "manage" ? renderBottomNav() : ""}
      ${state.page === "manage" ? '<div class="fab-layer"><div class="fab-shell"><button class="fab fab-scan" data-action="open-scanner" aria-label="扫描条形码"><span class="fab-scan-icon"><span></span><span class="fab-scan-line"></span></span></button></div></div>' : ""}
      ${state.scanner.open ? renderScannerSheet() : ""}
      ${state.scanResult ? renderScanResultSheet() : ""}
    </div>
  `;
  bindInputs();
}

function renderBottomNav() {
  return `
    <nav class="bottom-nav">
      <button class="nav-item ${state.page === "manage" ? "active" : ""}" data-nav="manage">
        <span>📋</span>
        <span>管理</span>
      </button>
      <button class="nav-item ${state.page === "calculator" ? "active" : ""}" data-nav="calculator">
        <span>🧮</span>
        <span>计算器</span>
      </button>
    </nav>
  `;
}

function renderManagePage(counts, records) {
  const archivedView = state.statusFilters.includes("archived");
  return `
    <header class="topbar">
      <div class="topbar-row">
        <div class="title-wrap">
          <h1>保质期管理</h1>
          <div class="subtitle subtitle-row">
            <span>共 ${counts.groupCount} 件商品</span>
            <button class="inline-add-button" data-action="go-add">手动添加</button>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="icon-button ${state.searchVisible ? "active" : ""}" data-action="toggle-search" aria-label="搜索">
            <span class="toolbar-search-icon" aria-hidden="true"></span>
          </button>
          <button class="icon-button ${state.filterPanelVisible ? "active" : ""}" data-action="toggle-filter-panel" aria-label="品类筛选">
            <span class="toolbar-filter-icon" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>
        </div>
      </div>
      ${state.searchVisible ? `
        <div class="search-panel">
          <input class="search-input" type="search" enterkeyhint="search" placeholder="搜索商品名称" value="${escapeHtml(state.search)}" data-input="search" />
        </div>
      ` : ""}
      ${state.filterPanelVisible ? renderCategoryFilterPanel() : ""}
      ${archivedView
        ? ''
        : `<div class="tabs">
            ${renderTab("all", "在售")}
            ${renderTab("attention", "待下架")}
          </div>`}
    </header>

    <main class="content">
      <div data-manage-list>${renderManageList(records)}</div>
    </main>
  `;
}

function renderCategoryFilterPanel() {
  return `
    <div class="filter-panel">
      <div class="filter-panel-head">
        <div class="filter-panel-title">筛选条件</div>
        <button class="filter-clear ${(state.categoryFilters.length || state.statusFilters.length) ? "" : "disabled"}" data-action="clear-all-filters">全部显示</button>
      </div>
      <div class="filter-group-label">状态</div>
      <div class="filter-chip-grid">
        ${[
          { id: "expired", label: "已过期" },
          { id: "archived", label: "已下架" },
        ].map((item) => `
          <button
            class="category-filter-chip ${state.statusFilters.includes(item.id) ? "active" : ""}"
            data-status-filter="${item.id}"
          >
            ${item.label}
          </button>
        `).join("")}
      </div>
      <div class="filter-group-label">品类</div>
      <div class="filter-chip-grid">
        ${categories.map((category) => `
          <button
            class="category-filter-chip ${state.categoryFilters.includes(category.id) ? "active" : ""}"
            data-category-filter="${category.id}"
          >
            ${category.label}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderManageList(records) {
  return records.length
    ? `<div class="stack">${records.map(renderProductCard).join("")}</div>`
    : `
      <section class="empty-state">
        <div>
          <div class="empty-icon">📦</div>
          <div class="empty-title">还没有符合条件的商品</div>
          <div class="empty-text">点击右下角按钮进入新页面添加商品。</div>
        </div>
      </section>
    `;
}

function renderAddPage() {
  return `
    <header class="topbar add-topbar">
      <div class="topbar-row">
        <div class="topbar-left">
          <button class="icon-button" data-action="go-manage" aria-label="返回">
            <span class="toolbar-back-icon" aria-hidden="true"></span>
          </button>
          <div class="title-wrap add-title-wrap">
            <h1>添加商品</h1>
            <div class="subtitle">新页面录入，保存后自动返回管理页</div>
          </div>
        </div>
      </div>
    </header>

    <main class="content">
      <section class="panel">
        ${state.form.barcode ? `
          <div class="barcode-note">
            <div class="barcode-note-label">已识别条码</div>
            <div class="barcode-note-value">${escapeHtml(state.form.barcode)}</div>
          </div>
        ` : ""}
        ${state.form.scanHint ? `<div class="helper-text" style="margin-top:12px;">${escapeHtml(state.form.scanHint)}</div>` : ""}
        <div class="field">
          <label class="field-label" for="item-name">商品名称</label>
          <input id="item-name" class="text-field" type="text" enterkeyhint="done" maxlength="30" placeholder="例如：牛奶、面包、感冒药" value="${escapeHtml(state.form.name)}" data-form-input="name" />
        </div>
        <div class="field">
          <div class="field-label">分类</div>
          <div class="category-grid">
            ${categories.map((category) => `
              <button class="category-chip ${state.form.category === category.id ? "active" : ""}" data-category="${category.id}">
                <span class="category-icon">${category.icon}</span>
                <span>${category.label}</span>
              </button>
            `).join("")}
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="production-date">生产日期</label>
          <input id="production-date" class="text-field" type="date" value="${state.form.productionDate}" data-form-input="productionDate" />
        </div>
        <div class="field">
          <div class="field-label">保质期</div>
          <div class="inline-row">
            <input class="text-field" type="number" min="1" inputmode="numeric" placeholder="输入数值" value="${escapeHtml(state.form.shelfLifeValue)}" data-form-input="shelfLifeValue" />
            <div class="segment">
              <button class="${state.form.shelfLifeUnit === "days" ? "active" : ""}" data-form-unit="days">天</button>
              <button class="${state.form.shelfLifeUnit === "months" ? "active" : ""}" data-form-unit="months">月</button>
            </div>
          </div>
          <div class="quick-grid" style="margin-top:12px;">
            ${quickValues.map((value) => `<button class="quick-chip ${Number(state.form.shelfLifeValue) === value ? "active" : ""}" data-form-quick="${value}">${value}${state.form.shelfLifeUnit === "months" ? "月" : "天"}</button>`).join("")}
          </div>
        </div>
        ${state.formWarning ? `<div class="warning-text">${escapeHtml(state.formWarning)}</div>` : ""}
        ${state.formError ? `<div class="error-text">${escapeHtml(state.formError)}</div>` : ""}
        <div class="field" style="display:grid;grid-template-columns:1fr 1.2fr;gap:12px;">
          <button class="ghost-button" data-action="go-manage">取消</button>
          <button class="primary-button" data-action="submit-form">添加商品</button>
        </div>
      </section>
    </main>
  `;
}

function renderScannerSheet() {
  return `
    <div class="scanner-backdrop" data-action="close-scanner">
      <div class="scanner-sheet" data-scanner-sheet="true">
        <div class="scanner-sheet-head">
          <div>
            <div class="scanner-title">扫描条形码</div>
            <div class="scanner-subtitle">优先识别商品条形码，查到模板后自动填充。</div>
          </div>
          <div class="scanner-head-actions">
            <button class="header-action-button" data-action="toggle-scanner-devices">${state.scanner.devicePickerVisible ? "收起镜头" : "切换摄像头"}</button>
            <button class="icon-button" data-action="close-scanner" aria-label="关闭">✕</button>
          </div>
        </div>
        <div class="scanner-preview">
          <video class="scanner-video" data-scanner-video autoplay playsinline muted></video>
          <div class="scanner-frame"></div>
        </div>
        <div class="scanner-status" data-scanner-status>${escapeHtml(state.scanner.message || "请把条形码对准扫描框")}</div>
        <div data-scanner-devices>${renderScannerDevices()}</div>
      </div>
    </div>
  `;
}

function renderScannerDevices() {
  if (!state.scanner.devicePickerVisible) return "";
  if (!state.scanner.devices.length) {
    return `
      <div class="scanner-device-panel">
        <div class="scanner-device-title">可用镜头</div>
        <div class="scanner-device-empty">暂时还没拿到镜头列表，请稍等一下。</div>
      </div>
    `;
  }
  return `
    <div class="scanner-device-panel">
      <div class="scanner-device-title">可用镜头</div>
      <div class="scanner-device-list">
        ${state.scanner.devices.map((device, index) => `
          <button
            class="scanner-device-item ${device.deviceId === state.scanner.selectedDeviceId ? "active" : ""}"
            data-action="select-scanner-camera"
            data-device-id="${escapeHtml(device.deviceId)}"
            type="button"
          >
            <span>${escapeHtml(device.label || `镜头 ${index + 1}`)}</span>
            ${device.deviceId === state.scanner.selectedDeviceId ? '<span class="scanner-device-badge">当前</span>' : ""}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function refreshScannerMeta() {
  const statusNode = app.querySelector("[data-scanner-status]");
  if (statusNode) {
    statusNode.textContent = state.scanner.message || "请把条形码对准扫描框";
  }

  const devicesNode = app.querySelector("[data-scanner-devices]");
  if (devicesNode) {
    devicesNode.innerHTML = renderScannerDevices();
  }
}

function renderScanResultSheet() {
  if (!state.scanResult) return "";
  return renderBarcodeRecordsSheet();
}

function renderBarcodeRecordsSheet() {
  const { barcode, records, template } = state.scanResult;
  return `
    <div class="modal-backdrop" data-action="close-scan-result">
      <div class="modal-sheet" data-scan-result-sheet="true">
        <div class="modal-header">
          <div>
            <div class="modal-title">${template ? escapeHtml(template.name) : "条码批次记录"}</div>
            <div class="modal-subtitle">${escapeHtml(barcode)}${records.length ? ` · 共 ${records.length} 条记录` : " · 暂无历史记录"}</div>
          </div>
          <div class="modal-header-actions">
            <button class="header-action-button" data-action="scan-add-batch">新增批次</button>
            <button class="icon-button" data-action="close-scan-result" aria-label="关闭">✕</button>
          </div>
        </div>
        <div class="modal-content">
          ${records.length
            ? records.map(renderBarcodeRecordItem).join("")
            : `<article class="intent-card">
                <div class="intent-title">${template ? "还没有这个商品的批次记录" : "还没有这个条码的批次记录"}</div>
                <div class="intent-text">
                  ${template
                    ? "已找到商品模板，可以直接点右上角新增批次，只补生产日期。"
                    : "这个条码还没有模板，点右上角新增批次，补一次商品信息后会自动记住。"}
                </div>
              </article>`}
        </div>
      </div>
    </div>
  `;
}

function renderBarcodeRecordItem(batch) {
  return renderRecordCard(batch, "scan");
}

function renderCalculatorPage() {
  return `
    <header class="topbar">
      <div class="topbar-row">
        <div class="title-wrap">
          <h1>保质期计算器</h1>
          <div class="subtitle">快速计算下架日和过期日</div>
        </div>
      </div>
    </header>

    <main class="content">
      <section class="panel">
        <div class="field">
          <label class="field-label" for="calc-production">生产日期</label>
          <input id="calc-production" class="text-field" type="date" value="${state.calculator.productionDate}" data-calc-input="productionDate" />
        </div>
        <div class="field">
          <div class="field-label">保质期</div>
          <div class="inline-row">
            <input class="text-field" type="number" min="1" inputmode="numeric" placeholder="输入数值" value="${escapeHtml(state.calculator.shelfLifeValue)}" data-calc-input="shelfLifeValue" />
            <div class="segment">
              <button class="${state.calculator.shelfLifeUnit === "days" ? "active" : ""}" data-calc-unit="days">天</button>
              <button class="${state.calculator.shelfLifeUnit === "months" ? "active" : ""}" data-calc-unit="months">月</button>
            </div>
          </div>
          <div class="quick-grid" style="margin-top:12px;">
            ${quickValues.map((value) => `<button class="quick-chip ${Number(state.calculator.shelfLifeValue) === value ? "active" : ""}" data-calc-quick="${value}">${value}${state.calculator.shelfLifeUnit === "months" ? "月" : "天"}</button>`).join("")}
          </div>
        </div>
        <div class="preview-box" data-calculator-preview>${renderCalculatorPreview()}</div>
        <div class="helper-text">规则固定为：生产日期算第 1 天，下架日 = 过期日前 2 天。</div>
      </section>
    </main>
    ${renderBottomNav()}
  `;
}

function renderTab(filter, label) {
  return `<button class="tab ${state.filter === filter ? "active" : ""}" data-filter="${filter}">${label}</button>`;
}

function renderRecordCard(batch, mode = "manage") {
  const productionItemClass = batch.status === "archived" ? "archived" : "";
  const removalItemClass = batch.status === "expired"
    ? "expired"
    : batch.status === "removeSoon"
      ? "removeSoon"
      : batch.status === "upcomingRemove"
        ? "upcomingRemove"
        : batch.status === "archived"
          ? "archived"
          : "";
  const expiryItemClass = batch.status === "expired" ? "expired" : batch.status === "archived" ? "archived" : "";
  const isManage = mode === "manage";
  const canArchive = !batch.archived;
  const swiped = canArchive && state.swipedGroupKey === batch.id;
  const infoExpanded = state.expandedInfoId === batch.id;

  return `
    <section class="product-card ${batch.archived ? "archived-card" : ""} ${isManage && swiped ? "swiped" : ""}" ${isManage && canArchive ? `data-swipe-key="${escapeHtml(batch.id)}"` : ""}>
      ${isManage && canArchive ? `
        <div class="swipe-actions">
          <button class="swipe-action archive" data-action="archive-record" data-id="${escapeHtml(batch.id)}">下架</button>
        </div>
      ` : ""}
      <div class="product-main" ${isManage ? `data-longpress-id="${escapeHtml(batch.id)}"` : ""} data-action="toggle-record-info" data-id="${escapeHtml(batch.id)}">
        <div class="product-head">
          <div class="product-head-main">
            <div class="product-title">${escapeHtml(batch.name)}</div>
            ${batch.barcode ? `<div class="product-barcode">条码 ${escapeHtml(batch.barcode)}</div>` : ""}
          </div>
          <span class="status-dot ${batch.status}">${statusText(batch.status)}</span>
        </div>

        ${infoExpanded ? `
          <div class="product-info-panel">
            <div class="product-info-row">
              <span class="product-info-label">添加日期</span>
              <span class="product-info-value">${escapeHtml(formatCreatedDate(batch.createdAt) || formatDisplayDate(batch.productionDate))}</span>
            </div>
          </div>
        ` : ""}

        <div class="date-summary">
          <div class="date-summary-item ${productionItemClass}">
            <div class="date-summary-label">生产日期</div>
            <div class="date-summary-value">${formatDisplayDate(batch.productionDate)}</div>
          </div>
          <div class="date-summary-item ${removalItemClass}">
            <div class="date-summary-label">下架日期</div>
            <div class="date-summary-value">${formatDisplayDate(batch.removalDate)}</div>
            <div class="countdown">${formatCountdown(batch.removalCountdown, "下架")}</div>
          </div>
          <div class="date-summary-item ${expiryItemClass}">
            <div class="date-summary-label">过期日期</div>
            <div class="date-summary-value">${formatDisplayDate(batch.expiryDate)}</div>
            <div class="countdown">${formatExpiryCountdown(batch.expiryCountdown)}</div>
          </div>
        </div>

        ${mode === "scan" ? `
          <div class="record-inline-actions">
            ${batch.archived
              ? '<span class="record-inline-state">已下架</span>'
              : `<button class="record-inline-button" data-action="archive-record" data-id="${escapeHtml(batch.id)}">下架这个批次</button>`}
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function renderProductCard(batch) {
  return renderRecordCard(batch, "manage");
}

function renderFormPreview() {
  const preview = getPreview(state.form);
  if (!preview) return '<div class="helper-text">输入生产日期和保质期后，这里会自动显示下架日和过期日。</div>';
  return `
    <div class="preview-grid">
      <div class="preview-item">
        <div class="preview-label">下架日</div>
        <div class="preview-value">${formatDisplayDate(preview.removalDate)}</div>
      </div>
      <div class="preview-item">
        <div class="preview-label">过期日</div>
        <div class="preview-value">${formatDisplayDate(preview.expiryDate)}</div>
      </div>
    </div>
  `;
}

function renderCalculatorPreview() {
  const preview = getPreview(state.calculator);
  if (!preview) return '<div class="helper-text">输入生产日期和保质期后，立即显示计算结果。</div>';
  return `
    <div class="preview-grid">
      <div class="preview-item">
        <div class="preview-label">下架日</div>
        <div class="preview-value">${formatDisplayDate(preview.removalDate)}</div>
      </div>
      <div class="preview-item">
        <div class="preview-label">过期日</div>
        <div class="preview-value">${formatDisplayDate(preview.expiryDate)}</div>
      </div>
    </div>
  `;
}

function bindInputs() {
  const searchInput = app.querySelector("[data-input='search']");
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      state.search = event.target.value;
      refreshManageList();
    });
    bindSoftKeyboardDone(searchInput);
  }

  app.querySelectorAll("[data-form-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
    state.form[event.target.dataset.formInput] = event.target.value;
    state.formError = "";
    state.formWarning = "";
    refreshFormPreview();
  });
    if (input.dataset.formInput === "name") {
      bindSoftKeyboardDone(input);
    }
  });

  app.querySelectorAll("[data-calc-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.calculator[event.target.dataset.calcInput] = event.target.value;
      refreshCalculatorPreview();
    });
  });

  bindSwipeGestures();
  bindLongPressDelete();
  bindScanner();
}

function bindSoftKeyboardDone(input) {
  const closeKeyboard = (event) => {
    event.preventDefault();
    event.target.blur();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      closeKeyboard(event);
    }
  });

  input.addEventListener("keyup", (event) => {
    if (event.key === "Enter") {
      closeKeyboard(event);
    }
  });

  input.addEventListener("beforeinput", (event) => {
    if (event.inputType === "insertLineBreak") {
      closeKeyboard(event);
    }
  });
}

function refreshFormPreview() {
  const node = app.querySelector("[data-form-preview]");
  if (node) node.innerHTML = renderFormPreview();
}

function refreshCalculatorPreview() {
  const node = app.querySelector("[data-calculator-preview]");
  if (node) node.innerHTML = renderCalculatorPreview();
}

function refreshManageList() {
  const node = app.querySelector("[data-manage-list]");
  if (!node) return;
  node.innerHTML = renderManageList(getVisibleBatches());
  bindSwipeGestures();
}

function bindScanner() {
  if (!state.scanner.open) return;
  if (state.scanner.status === "unsupported" || state.scanner.status === "error") return;
  const video = app.querySelector("[data-scanner-video]");
  if (!video) return;

  if ("BarcodeDetector" in window) {
    bindNativeScanner(video);
    return;
  }

  if (window.ZXingBrowser) {
    bindZxingScanner(video);
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    state.scanner.status = "unsupported";
    state.scanner.message = "当前浏览器不支持摄像头扫码。";
    render();
    return;
  }

  state.scanner.status = "unsupported";
  state.scanner.message = "当前浏览器暂不支持扫码，请稍后重试或更换浏览器。";
  render();
}

function bindNativeScanner(video) {
  if (state.scanner.stream) {
    attachScannerStream(video);
    queueScan(video);
    return;
  }

  startScanner(video, state.scanner.selectedDeviceId || "");
}

async function startScanner(video, preferredDeviceId = "") {
  try {
    state.scanner.status = "opening";
    state.scanner.message = "正在打开摄像头...";
    refreshScannerMeta();
    await loadScannerDevices();
    const rememberedDeviceId = resolvePreferredDeviceIdFromDevices(state.scanner.devices);
    const desiredDeviceId = preferredDeviceId || rememberedDeviceId || "";
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(buildScannerConstraints(desiredDeviceId));
    } catch {
      stream = await navigator.mediaDevices.getUserMedia(buildScannerConstraints());
    }
    await optimizeScannerTrack(stream);
    state.scanner.selectedDeviceId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || desiredDeviceId || "";
    state.scanner.preferredDeviceId = state.scanner.selectedDeviceId || state.scanner.preferredDeviceId;
    const selectedDevice = state.scanner.devices.find((device) => device.deviceId === state.scanner.selectedDeviceId);
    state.scanner.preferredDeviceLabel = selectedDevice?.label || state.scanner.preferredDeviceLabel || "";
    if (state.scanner.selectedDeviceId) savePreferredScannerDevice(state.scanner.selectedDeviceId, state.scanner.preferredDeviceLabel);
    await loadScannerDevices();
    state.scanner.stream = stream;
    state.scanner.detector = new window.BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"],
    });
    state.scanner.backend = "native";
    state.scanner.status = "scanning";
    state.scanner.message = "请把条形码放进扫描框";
    refreshScannerMeta();
    attachScannerStream(video);
    queueScan(video);
  } catch (error) {
    state.scanner.status = "error";
    state.scanner.message = "无法打开摄像头，请检查浏览器权限。";
    render();
  }
}

function attachScannerStream(video) {
  if (!video || !state.scanner.stream) return;
  if (video.srcObject !== state.scanner.stream) {
    video.srcObject = state.scanner.stream;
  }
  video.play().catch(() => {});
}

function queueScan(video) {
  if (state.scanner.backend && state.scanner.backend !== "native") return;
  if (!state.scanner.open || state.scanner.timerId || !state.scanner.detector) return;
  state.scanner.timerId = window.setTimeout(async () => {
    state.scanner.timerId = null;
    if (!state.scanner.open) return;
    try {
      const barcodes = await state.scanner.detector.detect(video);
      const detected = barcodes.find((item) => normalizeBarcode(item.rawValue));
      if (detected) {
        applyBarcodeResult(detected.rawValue);
        return;
      }
    } catch {
      state.scanner.message = "识别中，请保持条形码稳定";
    }
    queueScan(video);
  }, 220);
}

function bindZxingScanner(video) {
  if (state.scanner.controls) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    state.scanner.status = "unsupported";
    state.scanner.message = "当前浏览器不支持摄像头扫码。";
    render();
    return;
  }

  startZxingScanner(video, state.scanner.selectedDeviceId || "");
}

async function startZxingScanner(video, preferredDeviceId = "") {
  try {
    state.scanner.status = "opening";
    state.scanner.message = "正在打开摄像头...";
    refreshScannerMeta();
    const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    await loadScannerDevices();
    const rememberedDeviceId = resolvePreferredDeviceIdFromDevices(state.scanner.devices);
    const desiredDeviceId = preferredDeviceId || rememberedDeviceId || "";
    const controls = await reader.decodeFromConstraints(
      buildScannerConstraints(desiredDeviceId),
      video,
      (result, error, localControls) => {
        if (result?.getText()) {
          if (localControls?.stop) localControls.stop();
          state.scanner.controls = null;
          applyBarcodeResult(result.getText());
        } else if (error && state.scanner.open) {
          state.scanner.message = "识别中，请保持条形码稳定";
        }
      },
    );
    const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
    if (stream) {
      await optimizeScannerTrack(stream);
      state.scanner.selectedDeviceId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || desiredDeviceId || "";
      state.scanner.preferredDeviceId = state.scanner.selectedDeviceId || state.scanner.preferredDeviceId;
      const selectedDevice = state.scanner.devices.find((device) => device.deviceId === state.scanner.selectedDeviceId);
      state.scanner.preferredDeviceLabel = selectedDevice?.label || state.scanner.preferredDeviceLabel || "";
      if (state.scanner.selectedDeviceId) savePreferredScannerDevice(state.scanner.selectedDeviceId, state.scanner.preferredDeviceLabel);
      await loadScannerDevices();
    }
    state.scanner.controls = controls;
    state.scanner.backend = "zxing";
    state.scanner.status = "scanning";
    state.scanner.message = "请把条形码放进扫描框";
    refreshScannerMeta();
  } catch {
    state.scanner.status = "error";
    state.scanner.message = "无法打开摄像头，请检查浏览器权限。";
    render();
  }
}

async function switchScannerCamera() {
  await loadScannerDevices();
  if (state.scanner.devices.length <= 1) {
    state.scanner.message = "当前浏览器只暴露了一个镜头，暂时无法切换。";
    render();
    return;
  }

  const currentIndex = state.scanner.deviceIndex >= 0
    ? state.scanner.deviceIndex
    : state.scanner.devices.findIndex((device) => device.deviceId === state.scanner.selectedDeviceId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % state.scanner.devices.length : 0;
  const nextDevice = state.scanner.devices[nextIndex];

  resetScanner({ keepMessage: true });
  state.scanner.open = true;
  state.scanner.devices = await navigator.mediaDevices.enumerateDevices().then((devices) => devices.filter((device) => device.kind === "videoinput")).catch(() => []);
  state.scanner.deviceIndex = nextIndex;
  state.scanner.selectedDeviceId = nextDevice.deviceId;
  state.scanner.message = `正在切换镜头 ${nextIndex + 1}`;
  render();
}

function closeSwipeActions() {
  state.swipedGroupKey = null;
}

function bindSwipeGestures() {
  let activeKey = null;
  let startX = 0;
  let startY = 0;
  let tracking = false;

  app.querySelectorAll("[data-swipe-key]").forEach((card) => {
    card.ontouchstart = (event) => {
      const touch = event.touches[0];
      activeKey = card.dataset.swipeKey;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };

    card.ontouchmove = (event) => {
      if (!tracking || !activeKey) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      if (Math.abs(deltaY) > Math.abs(deltaX) * 0.9) {
        tracking = false;
        return;
      }
      if (deltaX < -20) {
        state.swipedGroupKey = activeKey;
        refreshManageList();
        tracking = false;
      } else if (deltaX > 18 && state.swipedGroupKey === activeKey) {
        closeSwipeActions();
        refreshManageList();
        tracking = false;
      }
    };

    card.ontouchend = () => {
      tracking = false;
      activeKey = null;
    };
  });
}

function bindLongPressDelete() {
  let timerId = null;
  let armedId = null;
  let startX = 0;
  let startY = 0;

  const cancelLongPress = () => {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    armedId = null;
  };

  const armLongPress = (id) => {
    cancelLongPress();
    armedId = id;
    timerId = window.setTimeout(() => {
      timerId = null;
      if (!armedId) return;
      performDeleteRecord(armedId);
      armedId = null;
    }, 650);
  };

  app.querySelectorAll("[data-longpress-id]").forEach((card) => {
    card.oncontextmenu = (event) => event.preventDefault();

    card.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      armLongPress(card.dataset.longpressId);
    }, { passive: true });

    card.addEventListener("touchmove", (event) => {
      const touch = event.touches[0];
      if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
        cancelLongPress();
      }
    }, { passive: true });

    card.addEventListener("touchend", cancelLongPress);
    card.addEventListener("touchcancel", cancelLongPress);

    card.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      armLongPress(card.dataset.longpressId);
    });

    card.addEventListener("mousemove", (event) => {
      if (!timerId) return;
      if (Math.abs(event.clientX - startX) > 8 || Math.abs(event.clientY - startY) > 8) {
        cancelLongPress();
      }
    });

    card.addEventListener("mouseup", cancelLongPress);
    card.addEventListener("mouseleave", cancelLongPress);
  });
}

app.addEventListener("click", (event) => {
  const scannerSheet = event.target.closest("[data-scanner-sheet]");
  if (scannerSheet && !event.target.closest("button")) {
    return;
  }

  const scanResultSheet = event.target.closest("[data-scan-result-sheet]");
  if (scanResultSheet && !event.target.closest("button")) {
    return;
  }

  const target = event.target.closest("button, [data-action]");
  if (!target) {
    if (state.swipedGroupKey) {
      closeSwipeActions();
      refreshManageList();
    }
    return;
  }

  if (target.dataset.nav) {
    closeSwipeActions();
    resetScanner();
    state.page = target.dataset.nav;
    render();
    return;
  }

  if (target.dataset.filter) {
    closeSwipeActions();
    state.filter = target.dataset.filter;
    render();
    return;
  }

  if (target.dataset.categoryFilter) {
    closeSwipeActions();
    const categoryId = target.dataset.categoryFilter;
    state.categoryFilters = state.categoryFilters.includes(categoryId)
      ? state.categoryFilters.filter((item) => item !== categoryId)
      : [...state.categoryFilters, categoryId];
    render();
    return;
  }

  if (target.dataset.statusFilter) {
    closeSwipeActions();
    const statusId = target.dataset.statusFilter;
    state.statusFilters = state.statusFilters.includes(statusId)
      ? state.statusFilters.filter((item) => item !== statusId)
      : [...state.statusFilters, statusId];
    render();
    return;
  }

  if (target.dataset.category) {
    state.form.category = target.dataset.category;
    render();
    return;
  }

  if (target.dataset.formUnit) {
    state.form.shelfLifeUnit = target.dataset.formUnit;
    render();
    return;
  }

  if (target.dataset.calcUnit) {
    state.calculator.shelfLifeUnit = target.dataset.calcUnit;
    render();
    return;
  }

  if (target.dataset.formQuick) {
    state.form.shelfLifeValue = target.dataset.formQuick;
    render();
    return;
  }

  if (target.dataset.calcQuick) {
    state.calculator.shelfLifeValue = target.dataset.calcQuick;
    render();
    return;
  }

  handleAction(target.dataset.action, target);
});

function handleAction(action, target) {
  if (action !== "archive-record" && action !== "delete-record") {
    closeSwipeActions();
  }

  if (action === "toggle-search") {
    state.searchVisible = !state.searchVisible;
    render();
    return;
  }

  if (action === "toggle-filter-panel") {
    state.filterPanelVisible = !state.filterPanelVisible;
    render();
    return;
  }

  if (action === "clear-all-filters") {
    state.categoryFilters = [];
    state.statusFilters = [];
    render();
    return;
  }

  if (action === "toggle-record-info") {
    const id = target.dataset.id;
    state.expandedInfoId = state.expandedInfoId === id ? null : id;
    render();
    return;
  }

  if (action === "go-add") {
    state.pendingAddDraft = null;
    openAddPage();
    return;
  }

  if (action === "go-manage") {
    resetScanner();
    state.page = "manage";
    state.formError = "";
    state.formWarning = "";
    render();
    return;
  }

  if (action === "open-scanner") {
    clearScanResult();
    state.scanner.open = true;
    state.scanner.status = "idle";
    state.scanner.message = "请把条形码对准扫描框";
    state.scanner.devicePickerVisible = false;
    const preferredCameraPreference = loadPreferredScannerPreference();
    state.scanner.selectedDeviceId = state.scanner.preferredDeviceId || preferredCameraPreference.deviceId;
    state.scanner.preferredDeviceId = state.scanner.preferredDeviceId || preferredCameraPreference.deviceId;
    state.scanner.preferredDeviceLabel = state.scanner.preferredDeviceLabel || preferredCameraPreference.label;
    render();
    return;
  }

  if (action === "toggle-scanner-devices") {
    state.scanner.devicePickerVisible = !state.scanner.devicePickerVisible;
    render();
    return;
  }

  if (action === "select-scanner-camera") {
    const deviceId = target.dataset.deviceId || "";
    if (!deviceId || deviceId === state.scanner.selectedDeviceId) return;
    const selectedDevice = state.scanner.devices.find((device) => device.deviceId === deviceId);
    resetScanner({ keepMessage: true });
    state.scanner.open = true;
    state.scanner.selectedDeviceId = deviceId;
    state.scanner.preferredDeviceId = deviceId;
    state.scanner.preferredDeviceLabel = selectedDevice?.label || "";
    state.scanner.devicePickerVisible = false;
    savePreferredScannerDevice(deviceId, state.scanner.preferredDeviceLabel);
    state.scanner.message = "正在切换镜头...";
    render();
    return;
  }

  if (action === "close-scanner") {
    resetScanner();
    render();
    return;
  }

  if (action === "close-scan-result") {
    clearScanResult();
    render();
    return;
  }

  if (action === "scan-add-batch") {
    goToAddPageWithScanResult();
    return;
  }

  if (action === "submit-form") {
    submitForm();
    return;
  }

  if (action === "archive-record") {
    const id = target.dataset.id;
    state.batches = state.batches.map((batch) => (
      batch.id === id
        ? { ...batch, archived: true, archivedAt: new Date().toISOString() }
        : batch
    ));
    saveBatches();
    closeSwipeActions();
    refreshScanResultRecords();
    render();
    return;
  }

  if (action === "delete-record") {
    performDeleteRecord(target.dataset.id);
    return;
  }

}

function performDeleteRecord(id) {
  if (!id) return;
  if (!window.confirm("长按已触发删除，确定删除这条商品记录吗？删除后无法恢复。")) return;
  state.batches = state.batches.filter((batch) => batch.id !== id);
  saveBatches();
  closeSwipeActions();
  render();
}

function submitForm() {
  const { name, category, productionDate, shelfLifeValue, shelfLifeUnit, barcode } = state.form;
  state.formWarning = "";
  if (!name.trim()) {
    state.formError = "请输入商品名称。";
    render();
    return;
  }
  if (!productionDate) {
    state.formError = "请选择生产日期。";
    render();
    return;
  }
  if (!Number(shelfLifeValue) || Number(shelfLifeValue) <= 0) {
    state.formError = "请输入正确的保质期数值。";
    render();
    return;
  }
  if (hasDuplicateBatch({ name, productionDate, barcode })) {
    state.formWarning = "检测到当前在售中可能已有同一批次，已继续添加，请确认是否重复。";
  }
  const batch = createBatchRecord({
    id: createId(),
    name,
    category,
    productionDate,
    shelfLifeValue: Number(shelfLifeValue),
    shelfLifeUnit,
    barcode,
  });
  state.batches.unshift(batch);
  saveBatches();
  if (barcode) {
    upsertTemplate({
      barcode,
      name,
      category,
      shelfLifeValue: Number(shelfLifeValue),
      shelfLifeUnit,
    });
  }
  resetScanner();
  state.form = createDefaultForm();
  state.formError = "";
  state.formWarning = "";
  state.filter = "all";
  state.page = "manage";
  render();
}

function statusText(status) {
  if (status === "expired") return "已过期";
  if (status === "removeSoon") return "待处理";
  if (status === "archived") return "已下架";
  return "正常";
}

function formatCountdown(days, label) {
  if (days < 0) return `已过 ${Math.abs(days)} 天`;
  if (days === 0) return `今天${label}`;
  return `${days} 天后${label}`;
}

function formatExpiryCountdown(days) {
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天过期";
  return `剩余 ${days} 天`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

purgeExpiredArchivedRecords();
render();
