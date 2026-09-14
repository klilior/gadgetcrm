export function createCorrelationId(prefix = "flow") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function resolveCorrelationId(req, providedId, prefix = "flow") {
  const headerId = req?.headers?.get?.("x-correlation-id");
  const candidate = String(providedId || headerId || "").trim();
  return candidate || createCorrelationId(prefix);
}