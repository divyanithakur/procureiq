"use strict";

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function calculatePriceVariance(price, benchmark) {
  const paid = toPositiveNumber(price);
  const base = toPositiveNumber(benchmark);
  if (!paid || !base) return 0;
  return ((paid - base) / base) * 100;
}

function calculatePotentialSaving(price, benchmark, quantity) {
  const paid = toPositiveNumber(price);
  const base = toPositiveNumber(benchmark);
  const units = toPositiveNumber(quantity);
  if (!paid || !base || !units) return 0;
  return Math.max(0, (paid - base) * units);
}

function summarizePriceExceptions(rows) {
  const groups = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const material = String(row?.material || "Unknown Material").trim();
    const supplier = String(row?.supplier || "Unknown Supplier").trim();
    const price = toPositiveNumber(row?.price);
    const quantity = toPositiveNumber(row?.quantity);
    if (!price || !quantity) continue;

    if (!groups.has(material)) groups.set(material, []);
    groups.get(material).push({ material, supplier, price, quantity, id: Number(row?.id) || 0 });
  }

  const opportunities = [];
  for (const items of groups.values()) {
    const benchmark = Math.min(...items.map(item => item.price));
    for (const item of items) {
      if (item.price <= benchmark) continue;
      const variance = calculatePriceVariance(item.price, benchmark);
      const saving = calculatePotentialSaving(item.price, benchmark, item.quantity);
      opportunities.push({ ...item, minPrice: benchmark, variance, saving });
    }
  }

  return opportunities.sort((a, b) => b.saving - a.saving);
}

module.exports = {
  toPositiveNumber,
  calculatePriceVariance,
  calculatePotentialSaving,
  summarizePriceExceptions
};
