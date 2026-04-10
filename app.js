const DAY_IN_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "shelf-life-manager-v2";

const categories = [
  { id: "dairy", label: "乳制品", icon: "🥛" },
  { id: "meat", label: "肉类", icon: "🥩" },
  { id: "snack", label: "零食", icon: "🍪" },
  { id: "drink", label: "饮料", icon: "🥤" },
  { id: "grain", label: "粮食", icon: "🍚" },
  { id: "medicine", label: "药品", icon: "💊" },
  { id: "cosmetic", label: "化妆品", icon: "💄" },
  { id: "other", label: "其他", icon: "📦" },
];

const quickValues = [3, 7, 10, 15, 30, 60, 90];
const todayIso = formatIsoDate(new Date());

const state = {
  page: "manage",
  filter: "all",
  searchVisible: false,
  search: "",
  expandedGroups: new Set(),
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

function sortProductGroups(groups, sortBy = "urgency", today = new Date()) {
  const statusRank = { expired: 0, removeSoon: 1, active: 2, archived: 3 };
  return [...groups].sort((left, right) => {
    const leftSummary = summarizeProductGroup(left, today);
    const rightSummary = summarizeProductGroup(right, today);
    if (sortBy === "name") return compareName(left.name, right.name);
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
      const matchedBatches = group.batches.filter((batch) => {
        if (state.search && !batch.name.includes(state.search.trim())) return false;
        if (state.filter !== "all" && batch.archived) return false;
        if (state.filter === "removeSoon" && batch.status !== "removeSoon") return false;
        if (state.filter === "expired" && batch.status !== "expired") return false;
        if (state.filter === "all" && batch.archived) return true;
        return true;
      });
      if (!matchedBatches.length) return null;
      return { ...group, batches: matchedBatches };
    })
    .filter(Boolean);
  return sortProductGroups(groups, "urgency", new Date());
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
        <button class="icon-button" data-action="toggle-search" aria-label="搜索">🔍</button>
      </div>
      ${state.searchVisible ? `
        <div class="search-panel">
          <input class="search-input" type="search" placeholder="搜索商品名称" value="${escapeHtml(state.search)}" data-input="search" />
        </div>
      ` : ""}
      <div class="tabs">
        ${renderTab("all", "全部")}
        ${renderTab("removeSoon", "即将过期")}
        ${renderTab("expired", "已过期")}
      </div>
    </header>

    <main class="content">
      <div data-manage-list>${renderManageList(groups)}</div>
    </main>
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
    <header class="topbar">
      <div class="topbar-row">
        <div class="topbar-left">
          <button class="icon-button" data-action="go-manage" aria-label="返回">←</button>
          <div class="title-wrap">
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
  const category = getCategoryMeta(group.category);
  const summary = summarizeProductGroup(group, new Date());
  const expanded = state.expandedGroups.has(group.key);
  const removalClass = summary.status === "expired" ? "expired" : summary.status === "removeSoon" ? "removeSoon" : "";
  const expiryClass = summary.status === "expired" ? "expired" : "";
  const removalItemClass = summary.status === "expired" ? "expired" : summary.status === "removeSoon" ? "removeSoon" : "";
  const expiryItemClass = summary.status === "expired" ? "expired" : "";
  const extraCount = Math.max(group.batches.length - 1, 0);
  const archivedOnly = group.batches.every((batch) => batch.archived);

  return `
    <section class="product-card ${expanded ? "expanded" : ""} ${archivedOnly ? "archived-card" : ""}">
      <div class="product-main" data-action="toggle-group" data-key="${escapeHtml(group.key)}">
        <div class="product-head">
          <div class="product-icon">${category.icon}</div>
          <div style="min-width:0;flex:1;">
            <div class="product-title">${escapeHtml(group.name)}</div>
            <div class="product-meta">${category.label}</div>
            ${
              archivedOnly
                ? '<div class="multi-note">已下架，记录仍保留</div>'
                : extraCount
                  ? `<div class="multi-note">还有 ${extraCount} 个同名商品，点击查看</div>`
                  : ""
            }
          </div>
          <span class="small-chip ${archivedOnly ? "archived" : ""}">${group.batches.length} 批</span>
        </div>

        <div class="date-summary">
          <div class="date-summary-item ${removalItemClass}">
            <div class="date-summary-label">下架日期</div>
            <div class="date-summary-value ${removalClass}">${formatShortDate(summary.nextBatch.removalDate)}</div>
            <div class="countdown">${formatCountdown(summary.removalCountdown, "下架")}</div>
          </div>
          <div class="date-summary-item ${expiryItemClass}">
            <div class="date-summary-label">过期日期</div>
            <div class="date-summary-value ${expiryClass}">${formatShortDate(summary.nextBatch.expiryDate)}</div>
            <div class="countdown">${formatExpiryCountdown(summary.expiryCountdown)}</div>
          </div>
        </div>

        <div class="product-footer">
          <span class="detail-hint">${expanded ? "收起明细" : "点击商品查看明细"}</span>
        </div>
      </div>

      <div class="batch-list">
        ${group.batches.map(renderBatchCard).join("")}
      </div>
    </section>
  `;
}

function renderBatchCard(batch) {
  const archived = Boolean(batch.archived);
  return `
    <article class="batch-card">
      <div class="batch-top">
        <div class="batch-label">批次 #${escapeHtml(batch.id.slice(-4))}</div>
        <span class="status-dot ${batch.status}">${statusText(batch.status)}</span>
      </div>
      <div class="batch-grid">
        <div class="batch-cell">
          <div class="batch-cell-label">生产日期</div>
          <div class="batch-cell-value">${formatDisplayDate(batch.productionDate)}</div>
        </div>
        <div class="batch-cell">
          <div class="batch-cell-label">下架日</div>
          <div class="batch-cell-value">${formatDisplayDate(batch.removalDate)}</div>
        </div>
        <div class="batch-cell">
          <div class="batch-cell-label">过期日</div>
          <div class="batch-cell-value">${formatDisplayDate(batch.expiryDate)}</div>
        </div>
      </div>
      <div class="batch-actions" style="margin-top:12px;">
        <div class="helper-text" style="margin:0;">保质期 ${batch.shelfLifeValue}${batch.shelfLifeUnit === "months" ? "个月" : "天"}${archived ? "，已下架保留" : ""}</div>
        <div style="display:flex;gap:8px;">
          ${
            archived
              ? `<button class="ghost-button" data-action="restore-batch" data-id="${batch.id}">恢复</button>`
              : `<button class="ghost-button" data-action="archive-batch" data-id="${batch.id}">下架</button>`
          }
          <button class="danger-button" data-action="delete-batch" data-id="${batch.id}">删除</button>
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
}

app.addEventListener("click", (event) => {
  const target = event.target.closest("button, [data-action]");
  if (!target) return;

  if (target.dataset.nav) {
    state.page = target.dataset.nav;
    render();
    return;
  }

  if (target.dataset.filter) {
    state.filter = target.dataset.filter;
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
  if (action === "toggle-search") {
    state.searchVisible = !state.searchVisible;
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

  if (action === "toggle-group") {
    const key = target.dataset.key;
    if (state.expandedGroups.has(key)) state.expandedGroups.delete(key);
    else state.expandedGroups.add(key);
    render();
    return;
  }

  if (action === "submit-form") {
    submitForm();
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
  state.page = "manage";
  state.expandedGroups.add(batch.normalizedName);
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

render();
