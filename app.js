const DAY_IN_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "shelf-life-manager-v2";
const ARCHIVE_RETENTION_DAYS = 30;

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
  categoryFilters: [],
  searchVisible: false,
  filterPanelVisible: false,
  search: "",
  swipedGroupKey: null,
  modalGroupKey: null,
  batches: loadBatches(),
  formError: "",
  form: createDefaultForm(),
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
  const shifted = new Date(date.getTime());
  shifted.setMonth(shifted.getMonth() + months);
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
  if (compareDate.getTime() >= addDays(removal, -1).getTime()) return "upcomingRemove";
  return "active";
}

function daysUntil(date, today = new Date()) {
  return Math.round((parseDateInput(date).getTime() - parseDateInput(today).getTime()) / DAY_IN_MS);
}

function createBatchRecord({ id, name, category, productionDate, shelfLifeValue, shelfLifeUnit }) {
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
    archived: false,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  };
}

function groupProductsByName(batches, today = new Date()) {
  const map = new Map();
  for (const batch of batches) {
    const key = batch.normalizedName || normalizeName(batch.name);
    const status = batch.archived
      ? "archived"
      : getBatchStatus({ removalDate: batch.removalDate, expiryDate: batch.expiryDate, today });
    if (!map.has(key)) {
      map.set(key, { key, name: batch.name, category: batch.category, batches: [] });
    }
    map.get(key).batches.push({ ...batch, status });
  }
  return Array.from(map.values())
    .map((group) => {
      group.batches.sort((left, right) => left.expiryDate.localeCompare(right.expiryDate));
      const visible = group.batches.filter((batch) => !batch.archived);
      const reference = visible[0] || group.batches[0];
      return {
        ...group,
        referenceStatus: reference?.status || "active",
        activeCount: visible.length,
        archivedCount: group.batches.length - visible.length,
      };
    })
    .sort((left, right) => {
      const leftDate = left.batches[0]?.expiryDate || "9999-12-31";
      const rightDate = right.batches[0]?.expiryDate || "9999-12-31";
      return leftDate.localeCompare(rightDate) || compareName(left.name, right.name);
    });
}

function summarizeProductGroup(group, today = new Date()) {
  const activeBatches = group.batches.filter((batch) => !batch.archived);
  const nextBatch = activeBatches[0] || group.batches[0] || null;
  if (!nextBatch) {
    return { nextBatch: null, removalCountdown: null, expiryCountdown: null, status: "active" };
  }
  return {
    nextBatch,
    removalCountdown: daysUntil(nextBatch.removalDate, today),
    expiryCountdown: daysUntil(nextBatch.expiryDate, today),
    status: nextBatch.status,
  };
}

function getAllRecordsForGroup(groupKey) {
  const groups = groupProductsByName(state.batches, new Date());
  const group = groups.find((item) => item.key === groupKey);
  if (!group) return null;
  return {
    ...group,
    batches: [...group.batches]
      .filter((batch) => !batch.archived)
      .sort((left, right) => left.expiryDate.localeCompare(right.expiryDate)),
  };
}

function sortProductGroups(groups, sortBy = "urgency", today = new Date()) {
  const statusRank = { expired: 0, removeSoon: 1, upcomingRemove: 2, active: 3, archived: 4 };
  return [...groups].sort((left, right) => {
    const leftSummary = summarizeProductGroup(left, today);
    const rightSummary = summarizeProductGroup(right, today);
    if (sortBy === "name") return compareName(left.name, right.name);
    if (sortBy === "createdAt") {
      const leftCreatedAt = left.batches.reduce((latest, batch) => (
        !latest || String(batch.createdAt || "") > latest ? String(batch.createdAt || "") : latest
      ), "");
      const rightCreatedAt = right.batches.reduce((latest, batch) => (
        !latest || String(batch.createdAt || "") > latest ? String(batch.createdAt || "") : latest
      ), "");
      return rightCreatedAt.localeCompare(leftCreatedAt) || compareName(left.name, right.name);
    }
    if (sortBy === "removalDate") {
      return (
        (leftSummary.nextBatch?.removalDate || "9999-12-31").localeCompare(rightSummary.nextBatch?.removalDate || "9999-12-31") ||
        compareName(left.name, right.name)
      );
    }
    if (sortBy === "expiryDate") {
      return (
        (leftSummary.nextBatch?.expiryDate || "9999-12-31").localeCompare(rightSummary.nextBatch?.expiryDate || "9999-12-31") ||
        compareName(left.name, right.name)
      );
    }
    return (
      statusRank[leftSummary.status] - statusRank[rightSummary.status] ||
      (leftSummary.nextBatch?.removalDate || "9999-12-31").localeCompare(rightSummary.nextBatch?.removalDate || "9999-12-31") ||
      (leftSummary.nextBatch?.expiryDate || "9999-12-31").localeCompare(rightSummary.nextBatch?.expiryDate || "9999-12-31") ||
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

function saveBatches() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.batches));
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

function getCategoryMeta(categoryId) {
  return categories.find((item) => item.id === categoryId) || categories[categories.length - 1];
}

function getCounts() {
  const groups = groupProductsByName(state.batches, new Date());
  const activeBatches = state.batches.filter((batch) => !batch.archived);
  const removeSoon = activeBatches.filter((batch) => batch.removalDate <= todayIso && batch.expiryDate >= todayIso).length;
  const expired = activeBatches.filter((batch) => batch.expiryDate < todayIso).length;
  return {
    groupCount: groups.length,
    activeBatchCount: activeBatches.length,
    removeSoon,
    expired,
  };
}

function getVisibleGroups() {
  const groups = groupProductsByName(state.batches, new Date())
    .map((group) => {
      if (state.categoryFilters.length && !state.categoryFilters.includes(group.category)) return null;
      const matchedBatches = group.batches.filter((batch) => {
        if (state.search && !batch.name.includes(state.search.trim())) return false;
        if (state.filter !== "all" && batch.archived) return false;
        if (state.filter === "attention" && batch.status === "active") return false;
        if (state.filter === "all" && batch.archived) return true;
        return true;
      });
      if (!matchedBatches.length) return null;
      return { ...group, batches: matchedBatches };
    })
    .filter(Boolean);
  return sortProductGroups(groups, state.filter === "all" ? "createdAt" : "urgency", new Date());
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
  let groups;
  try {
    counts = getCounts();
    groups = getVisibleGroups();
  } catch (error) {
    console.error("Render failed:", error);
    localStorage.removeItem(STORAGE_KEY);
    state.batches = [];
    counts = getCounts();
    groups = getVisibleGroups();
  }
  const pageContent = state.page === "manage"
    ? renderManagePage(counts, groups)
    : state.page === "add"
      ? renderAddPage()
      : renderCalculatorPage();
  app.innerHTML = `
    <div class="page">
      ${pageContent}
      ${state.page === "manage" ? renderBottomNav() : ""}
      ${state.page === "manage" ? '<div class="fab-layer"><button class="fab" data-action="go-add">+</button></div>' : ""}
      ${state.modalGroupKey ? renderRecordsModal() : ""}
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

function renderManagePage(counts, groups) {
  return `
    <header class="topbar">
      <div class="topbar-row">
        <div class="title-wrap">
          <h1>保质期管理</h1>
          <div class="subtitle">共 ${counts.groupCount} 件商品</div>
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
          <input class="search-input" type="search" placeholder="搜索商品名称" value="${escapeHtml(state.search)}" data-input="search" />
        </div>
      ` : ""}
      ${state.filterPanelVisible ? renderCategoryFilterPanel() : ""}
      <div class="tabs">
        ${renderTab("all", "全部")}
        ${renderTab("attention", "待下架")}
      </div>
    </header>

    <main class="content">
      <div data-manage-list>${renderManageList(groups)}</div>
    </main>
  `;
}

function renderCategoryFilterPanel() {
  return `
    <div class="filter-panel">
      <div class="filter-panel-head">
        <div class="filter-panel-title">筛选品类</div>
        <button class="filter-clear ${state.categoryFilters.length ? "" : "disabled"}" data-action="clear-category-filters">全部显示</button>
      </div>
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

function renderManageList(groups) {
  return groups.length
    ? `<div class="stack">${groups.map(renderProductCard).join("")}</div>`
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
        <div class="field">
          <label class="field-label" for="item-name">商品名称</label>
          <input id="item-name" class="text-field" type="text" maxlength="30" placeholder="例如：牛奶、面包、感冒药" value="${escapeHtml(state.form.name)}" data-form-input="name" />
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
        <div class="preview-box" data-form-preview>${renderFormPreview()}</div>
        ${state.formError ? `<div class="error-text">${escapeHtml(state.formError)}</div>` : ""}
        <div class="field" style="display:grid;grid-template-columns:1fr 1.2fr;gap:12px;">
          <button class="ghost-button" data-action="go-manage">取消</button>
          <button class="primary-button" data-action="submit-form">添加商品</button>
        </div>
      </section>
    </main>
  `;
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

function renderProductCard(group) {
  const summary = summarizeProductGroup(group, new Date());
  const productionItemClass = summary.status === "archived" ? "archived" : "";
  const removalItemClass = summary.status === "expired"
    ? "expired"
    : summary.status === "removeSoon"
      ? "removeSoon"
      : summary.status === "upcomingRemove"
        ? "upcomingRemove"
        : summary.status === "archived"
          ? "archived"
          : "";
  const expiryItemClass = summary.status === "expired" ? "expired" : summary.status === "archived" ? "archived" : "";
  const visibleCount = group.batches.filter((batch) => !batch.archived).length;
  const extraCount = Math.max(visibleCount - 1, 0);
  const archivedOnly = group.batches.every((batch) => batch.archived);
  const swiped = state.swipedGroupKey === group.key;

  return `
    <section class="product-card ${archivedOnly ? "archived-card" : ""} ${swiped ? "swiped" : ""}" data-swipe-key="${escapeHtml(group.key)}">
      <div class="swipe-actions">
        <button class="swipe-action archive" data-action="archive-group" data-key="${escapeHtml(group.key)}">下架</button>
        <button class="swipe-action delete" data-action="delete-group" data-key="${escapeHtml(group.key)}">删除</button>
      </div>
      <div class="product-main" data-action="open-group" data-key="${escapeHtml(group.key)}">
        <div class="product-head">
          <div class="product-head-main">
            <div class="product-title">${escapeHtml(group.name)}</div>
            <div class="product-meta">生产于 ${formatDisplayDate(summary.nextBatch.productionDate)}</div>
            ${
              archivedOnly
                ? '<div class="multi-note">已下架，记录仍保留</div>'
                : extraCount
                  ? `<div class="multi-note">包含 ${visibleCount} 条同名记录，当前展示最早到期项 <button class="view-all-link" data-action="open-group" data-key="${escapeHtml(group.key)}">查看全部</button></div>`
                  : ""
            }
          </div>
          <span class="status-dot ${summary.status}">${statusText(summary.status)}</span>
        </div>

        <div class="date-summary">
          <div class="date-summary-item ${productionItemClass}">
            <div class="date-summary-label">生产日期</div>
            <div class="date-summary-value">${formatDisplayDate(summary.nextBatch.productionDate)}</div>
            <div class="countdown">当前展示记录</div>
          </div>
          <div class="date-summary-item ${removalItemClass}">
            <div class="date-summary-label">下架日期</div>
            <div class="date-summary-value">${formatDisplayDate(summary.nextBatch.removalDate)}</div>
            <div class="countdown">${formatCountdown(summary.removalCountdown, "下架")}</div>
          </div>
          <div class="date-summary-item ${expiryItemClass}">
            <div class="date-summary-label">过期日期</div>
            <div class="date-summary-value">${formatDisplayDate(summary.nextBatch.expiryDate)}</div>
            <div class="countdown">${formatExpiryCountdown(summary.expiryCountdown)}</div>
          </div>
        </div>

        <div class="product-footer">
          <span class="detail-hint">左滑可下架或删除</span>
        </div>
      </div>
    </section>
  `;
}

function renderRecordsModal() {
  const group = getAllRecordsForGroup(state.modalGroupKey);
  if (!group) return "";

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal-sheet" data-modal-sheet="true">
        <div class="modal-header">
          <div>
            <div class="modal-title">${escapeHtml(group.name)}</div>
            <div class="modal-subtitle">共 ${group.batches.length} 条同名记录，按最早过期在前排序</div>
          </div>
          <button class="icon-button" data-action="close-modal" aria-label="关闭">✕</button>
        </div>
        <div class="modal-content">
          ${group.batches.map(renderRecordItem).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderRecordItem(batch) {
  return `
    <article class="record-item ${batch.status}">
      <div class="record-top">
        <div class="record-title">生产于 ${formatDisplayDate(batch.productionDate)}</div>
        <span class="status-dot ${batch.status}">${statusText(batch.status)}</span>
      </div>
      <div class="record-grid">
        <div class="record-cell">
          <div class="record-label">生产日期</div>
          <div class="record-value">${formatDisplayDate(batch.productionDate)}</div>
        </div>
        <div class="record-cell">
          <div class="record-label">下架日期</div>
          <div class="record-value">${formatDisplayDate(batch.removalDate)}</div>
        </div>
        <div class="record-cell">
          <div class="record-label">过期日期</div>
          <div class="record-value">${formatDisplayDate(batch.expiryDate)}</div>
        </div>
      </div>
    </article>
  `;
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
  }

  app.querySelectorAll("[data-form-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.form[event.target.dataset.formInput] = event.target.value;
      state.formError = "";
      refreshFormPreview();
    });
  });

  app.querySelectorAll("[data-calc-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.calculator[event.target.dataset.calcInput] = event.target.value;
      refreshCalculatorPreview();
    });
  });

  bindSwipeGestures();
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
  node.innerHTML = renderManageList(getVisibleGroups());
  bindSwipeGestures();
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

app.addEventListener("click", (event) => {
  const modalSheet = event.target.closest("[data-modal-sheet]");
  if (modalSheet && !event.target.closest("button")) {
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
  if (action !== "open-group" && action !== "archive-group" && action !== "delete-group") {
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

  if (action === "clear-category-filters") {
    state.categoryFilters = [];
    render();
    return;
  }

  if (action === "go-add") {
    state.page = "add";
    state.formError = "";
    render();
    return;
  }

  if (action === "go-manage") {
    state.page = "manage";
    state.formError = "";
    render();
    return;
  }

  if (action === "open-group") {
    state.modalGroupKey = target.dataset.key;
    closeSwipeActions();
    render();
    return;
  }

  if (action === "close-modal") {
    state.modalGroupKey = null;
    render();
    return;
  }

  if (action === "submit-form") {
    submitForm();
    return;
  }

  if (action === "archive-group") {
    const key = target.dataset.key;
    state.batches = state.batches.map((batch) => (
      (batch.normalizedName || normalizeName(batch.name)) === key
        ? { ...batch, archived: true, archivedAt: new Date().toISOString() }
        : batch
    ));
    saveBatches();
    closeSwipeActions();
    render();
    return;
  }

  if (action === "delete-group") {
    const key = target.dataset.key;
    if (!window.confirm("确定删除这组同名商品记录吗？删除后无法恢复。")) return;
    state.batches = state.batches.filter((batch) => (batch.normalizedName || normalizeName(batch.name)) !== key);
    saveBatches();
    closeSwipeActions();
    render();
    return;
  }

  if (action === "archive-batch") {
    state.batches = state.batches.map((batch) => (
      batch.id === target.dataset.id ? { ...batch, archived: true, archivedAt: new Date().toISOString() } : batch
    ));
    saveBatches();
    render();
    return;
  }

  if (action === "restore-batch") {
    state.batches = state.batches.map((batch) => (
      batch.id === target.dataset.id ? { ...batch, archived: false, archivedAt: null } : batch
    ));
    saveBatches();
    render();
    return;
  }

  if (action === "delete-batch") {
    deleteBatch(target.dataset.id);
  }
}

function submitForm() {
  const { name, category, productionDate, shelfLifeValue, shelfLifeUnit } = state.form;
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
  const batch = createBatchRecord({
    id: createId(),
    name,
    category,
    productionDate,
    shelfLifeValue: Number(shelfLifeValue),
    shelfLifeUnit,
  });
  state.batches.unshift(batch);
  saveBatches();
  state.form = createDefaultForm();
  state.formError = "";
  state.filter = "all";
  state.page = "manage";
  render();
}

function deleteBatch(batchId) {
  if (!window.confirm("确定删除这个批次吗？删除后无法恢复。")) return;
  state.batches = state.batches.filter((batch) => batch.id !== batchId);
  saveBatches();
  render();
}

function statusText(status) {
  if (status === "expired") return "已过期";
  if (status === "removeSoon") return "待处理";
  if (status === "upcomingRemove") return "即将处理";
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
