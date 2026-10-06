const defaultFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function formatINR(amount, options = {}) {
  const value = Number(amount) || 0;
  if (Object.keys(options).length === 0) return defaultFormatter.format(value);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}
