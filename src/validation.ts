import { HttpError } from "./http-error.js";

export function validateBody(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Invalid request body");
  }
  return body;
}

export function validateName(name: unknown) {
  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 100) {
    throw new HttpError(400, "Invalid name");
  }
  if (name.includes("\u0000")) {
    throw new HttpError(400, "Invalid name");
  }
  return name.trim();
}

export function validateNumber(n: unknown, field: string) {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) {
    throw new HttpError(400, "Invalid " + field);
  }
  return n;
}

export function validateId(id: unknown) {
  if (typeof id !== "string" || !/^[0-9]{1,19}$/.test(id)) {
    throw new HttpError(400, "Invalid ID: use a positive decimal string");
  }
  const n = BigInt(id);
  if (n <= 0n || n > 9223372036854775807n) {
    throw new HttpError(400, "Invalid ID");
  }
  return n.toString();
}

export function validatePlanId(body: unknown) {
  const row = validateBody(body);
  if (!("planId" in row)) {
    throw new HttpError(400, "Plan ID is missing");
  }
  return validateNumber(row.planId, "plan ID");
}

export function validateNameAndPlanId(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Invalid request body");
  }

  if (!("name" in body)) {
    throw new HttpError(400, "Name is missing");
  }

  if (typeof body.name !== "string" ||
      body.name.trim().length === 0 ||
      body.name.trim().length > 100 ||
      body.name.includes("\u0000")) {
    throw new HttpError(400, "Invalid name");
  }

  if (!("planId" in body)) {
    throw new HttpError(400, "Plan ID is missing");
  }

  if (typeof body.planId !== "number" ||
      body.planId <= 0 ||
      !Number.isSafeInteger(body.planId)) {
    throw new HttpError(400, "Invalid plan ID");
  }

  return {
    name: body.name.trim(),
    planId: body.planId,
  };
}

export function validatePlan(body: unknown) {
  const row = validateBody(body);
  if (!("name" in row) || !("planType" in row) || !("monthlyLimit" in row) || !("maxPerRequest" in row)) {
    throw new HttpError(400, "Name, planType, monthlyLimit and maxPerRequest are required");
  }
  if (row.planType !== "account" && row.planType !== "user") {
    throw new HttpError(400, "Invalid plan type");
  }
  return {
    name: validateName(row.name),
    planType: row.planType,
    monthlyLimit: validateNumber(row.monthlyLimit, "monthly limit"),
    maxPerRequest: validateNumber(row.maxPerRequest, "maximum per request"),
  };
}

export function validateConsumption(body: unknown) {
  const row = validateBody(body);
  if (!("userId" in row) || !("units" in row) || !("requestId" in row)) {
    throw new HttpError(400, "userId, units and requestId are required");
  }
  if (typeof row.requestId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(row.requestId)) {
    throw new HttpError(400, "Invalid request ID: use 1 to 128 visible ASCII characters");
  }
  return {
    userId: validateId(row.userId),
    units: validateNumber(row.units, "units"),
    requestId: row.requestId,
  };
}

export function validateMonth(month: string | null) {
  if (month === null) {
    return null;
  }
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000")) {
    throw new HttpError(400, "Invalid month: use YYYY-MM");
  }
  return month + "-01";
}

export function validatePage(n: string | null, fallback: number, max: number) {
  if (n === null) {
    return fallback;
  }
  if (!/^[0-9]+$/.test(n) || !Number.isSafeInteger(Number(n)) || Number(n) < 0 || Number(n) > max) {
    throw new HttpError(400, "Invalid pagination value");
  }
  return Number(n);
}
