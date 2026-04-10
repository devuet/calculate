const DAY_IN_MS = 24 * 60 * 60 * 1000;

function parseDateInput(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
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
  return String(name || '').trim().toLocaleLowerCase();
}

export function formatIsoDate(date) {
  const value = parseDateInput(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(date) {
  const value = parseDateInput(date);
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
}

export function calculateBatchDates({ productionDate, shelfLifeValue, shelfLifeUnit }) {
  const start = parseDateInput(productionDate);
  const numericValue = Number(shelfLifeValue);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error('Shelf life must be a positive number');
  }

  let expiryDate;
  if (shelfLifeUnit === 'months') {
    expiryDate = addMonthsInclusive(start, numericValue);
  } else {
    expiryDate = addDays(start, numericValue - 1);
  }

  const removalDate = addDays(expiryDate, -2);

  return {
    productionDate: start,
    expiryDate,
    removalDate,
  };
}

export function getBatchStatus({ removalDate, expiryDate, today = new Date() }) {
  const compareDate = parseDateInput(today);
  const removal = parseDateInput(removalDate);
  const expiry = parseDateInput(expiryDate);

  if (compareDate.getTime() > expiry.getTime()) {
    return 'expired';
  }

  if (compareDate.getTime() >= removal.getTime()) {
    return 'removeSoon';
  }

  return 'active';
}

export function daysUntil(date, today = new Date()) {
  const target = parseDateInput(date);
  const start = parseDateInput(today);
  return Math.round((target.getTime() - start.getTime()) / DAY_IN_MS);
}

export function createBatchRecord({
  id,
  name,
  category,
  productionDate,
  shelfLifeValue,
  shelfLifeUnit,
}) {
  const calculated = calculateBatchDates({
    productionDate,
    shelfLifeValue,
    shelfLifeUnit,
  });

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

export function groupProductsByName(batches, today = new Date()) {
  const map = new Map();

  for (const batch of batches) {
    const key = batch.normalizedName || normalizeName(batch.name);
    const status = batch.archived
      ? 'archived'
      : getBatchStatus(
          {
            removalDate: batch.removalDate,
            expiryDate: batch.expiryDate,
            today,
          },
        );

    if (!map.has(key)) {
      map.set(key, {
        key,
        name: batch.name,
        category: batch.category,
        batches: [],
      });
    }

    map.get(key).batches.push({
      ...batch,
      status,
    });
  }

  return Array.from(map.values())
    .map((group) => {
      group.batches.sort((left, right) => left.expiryDate.localeCompare(right.expiryDate));
      const visible = group.batches.filter((batch) => !batch.archived);
      const reference = visible[0] || group.batches[0];
      return {
        ...group,
        referenceStatus: reference?.status || 'active',
        activeCount: visible.length,
        archivedCount: group.batches.length - visible.length,
      };
    })
    .sort((left, right) => {
      const leftDate = left.batches[0]?.expiryDate || '9999-12-31';
      const rightDate = right.batches[0]?.expiryDate || '9999-12-31';
      return leftDate.localeCompare(rightDate) || left.name.localeCompare(right.name, 'zh-Hans-CN');
    });
}
