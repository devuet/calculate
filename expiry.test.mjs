import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateBatchDates,
  formatIsoDate,
  getBatchStatus,
  groupProductsByName,
  sortProductGroups,
  summarizeProductGroup,
} from './app-logic.mjs';

test('calculates expiry and removal dates with production day counted as day one', () => {
  const result = calculateBatchDates({
    productionDate: '2026-03-06',
    shelfLifeValue: 7,
    shelfLifeUnit: 'days',
  });

  assert.equal(formatIsoDate(result.expiryDate), '2026-03-12');
  assert.equal(formatIsoDate(result.removalDate), '2026-03-10');
});

test('keeps one-day shelf life expiring on the production date', () => {
  const result = calculateBatchDates({
    productionDate: '2026-04-10',
    shelfLifeValue: 1,
    shelfLifeUnit: 'days',
  });

  assert.equal(formatIsoDate(result.expiryDate), '2026-04-10');
  assert.equal(formatIsoDate(result.removalDate), '2026-04-08');
});

test('calculates monthly shelf life using natural month carry and inclusive expiry', () => {
  const result = calculateBatchDates({
    productionDate: '2026-04-10',
    shelfLifeValue: 1,
    shelfLifeUnit: 'months',
  });

  assert.equal(formatIsoDate(result.expiryDate), '2026-05-09');
  assert.equal(formatIsoDate(result.removalDate), '2026-05-07');
});

test('classifies status as expired, remove-soon, and active', () => {
  const expired = getBatchStatus({
    removalDate: '2026-03-10',
    expiryDate: '2026-03-12',
    today: '2026-03-13',
  });
  const removeSoon = getBatchStatus({
    removalDate: '2026-03-10',
    expiryDate: '2026-03-12',
    today: '2026-03-10',
  });
  const active = getBatchStatus({
    removalDate: '2026-03-10',
    expiryDate: '2026-03-12',
    today: '2026-03-09',
  });

  assert.equal(expired, 'expired');
  assert.equal(removeSoon, 'removeSoon');
  assert.equal(active, 'active');
});

test('groups same-name products and sorts batches by nearest expiry', () => {
  const grouped = groupProductsByName([
    {
      id: 'batch-1',
      name: '纯牛奶',
      category: 'dairy',
      productionDate: '2026-04-10',
      removalDate: '2026-04-15',
      expiryDate: '2026-04-17',
      archived: false,
      shelfLifeValue: 8,
      shelfLifeUnit: 'days',
    },
    {
      id: 'batch-2',
      name: '纯牛奶',
      category: 'dairy',
      productionDate: '2026-04-08',
      removalDate: '2026-04-10',
      expiryDate: '2026-04-12',
      archived: false,
      shelfLifeValue: 5,
      shelfLifeUnit: 'days',
    },
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].name, '纯牛奶');
  assert.equal(grouped[0].batches[0].id, 'batch-2');
  assert.equal(grouped[0].batches[1].id, 'batch-1');
});

test('summarizes group by next active batch and remaining days', () => {
  const [group] = groupProductsByName([
    {
      id: 'batch-1',
      name: '牛奶',
      category: 'dairy',
      productionDate: '2026-04-10',
      removalDate: '2026-04-14',
      expiryDate: '2026-04-16',
      archived: false,
      shelfLifeValue: 7,
      shelfLifeUnit: 'days',
    },
    {
      id: 'batch-2',
      name: '牛奶',
      category: 'dairy',
      productionDate: '2026-04-01',
      removalDate: '2026-04-04',
      expiryDate: '2026-04-06',
      archived: true,
      shelfLifeValue: 6,
      shelfLifeUnit: 'days',
    },
  ], '2026-04-10');

  const summary = summarizeProductGroup(group, '2026-04-10');

  assert.equal(summary.nextBatch.id, 'batch-1');
  assert.equal(summary.removalCountdown, 4);
  assert.equal(summary.expiryCountdown, 6);
});

test('sorts groups by urgency, removal date, expiry date and name', () => {
  const groups = groupProductsByName([
    {
      id: 'a-1',
      name: '饼干',
      category: 'snack',
      productionDate: '2026-04-01',
      removalDate: '2026-04-12',
      expiryDate: '2026-04-14',
      archived: false,
      shelfLifeValue: 14,
      shelfLifeUnit: 'days',
    },
    {
      id: 'b-1',
      name: '牛奶',
      category: 'dairy',
      productionDate: '2026-04-10',
      removalDate: '2026-04-10',
      expiryDate: '2026-04-12',
      archived: false,
      shelfLifeValue: 3,
      shelfLifeUnit: 'days',
    },
    {
      id: 'c-1',
      name: '可乐',
      category: 'drink',
      productionDate: '2026-04-05',
      removalDate: '2026-04-08',
      expiryDate: '2026-04-10',
      archived: false,
      shelfLifeValue: 6,
      shelfLifeUnit: 'days',
    },
  ], '2026-04-10');

  const byUrgency = sortProductGroups(groups, 'urgency', '2026-04-10');
  const byRemoval = sortProductGroups(groups, 'removalDate', '2026-04-10');
  const byExpiry = sortProductGroups(groups, 'expiryDate', '2026-04-10');
  const byName = sortProductGroups(groups, 'name', '2026-04-10');

  assert.deepEqual(byUrgency.map((group) => group.name), ['可乐', '牛奶', '饼干']);
  assert.deepEqual(byRemoval.map((group) => group.name), ['可乐', '牛奶', '饼干']);
  assert.deepEqual(byExpiry.map((group) => group.name), ['可乐', '牛奶', '饼干']);
  assert.deepEqual(byName.map((group) => group.name), ['饼干', '可乐', '牛奶']);
});
