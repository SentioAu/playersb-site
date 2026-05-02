// Lightweight, dependency-free JSON shape validator. Run before generators
// so a malformed data/*.json fails the build with a useful error instead of
// emitting half-broken HTML or crashing deep inside a template.
//
// Schemas are intentionally just the fields the generators actually depend on
// — adding a field everywhere would force backfills across historical seeds.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

function fail(label, msg) {
  return `${label}: ${msg}`;
}

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function checkType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  return false;
}

function validateField(value, schema, errors, path) {
  if (value === undefined) {
    if (schema.required) errors.push(fail(path, "required field is missing"));
    return;
  }
  if (value === null) {
    if (schema.nullable) return;
    if (schema.required) errors.push(fail(path, "required field is null"));
    return;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((t) => checkType(value, t));
    if (!ok) {
      errors.push(fail(path, `expected ${types.join("|")}, got ${typeof value}`));
      return;
    }
  }
  if (schema.type === "array" && schema.items) {
    for (let i = 0; i < value.length; i++) {
      validateRecord(value[i], schema.items, errors, `${path}[${i}]`);
    }
  }
  if (schema.type === "object" && schema.properties) {
    validateRecord(value, schema, errors, path);
  }
}

function validateRecord(value, schema, errors, path) {
  if (!isObject(value)) {
    errors.push(fail(path, `expected object, got ${typeof value}`));
    return;
  }
  const props = schema.properties || {};
  for (const [key, sub] of Object.entries(props)) {
    validateField(value[key], sub, errors, `${path}.${key}`);
  }
}

const PLAYER_RECORD = {
  type: "object",
  properties: {
    id: { type: "string", required: true },
    name: { type: "string", required: true },
    position: { type: "string" },
    team: { type: "string" },
    minutes: { type: ["number", "null"], nullable: true },
    goals: { type: ["number", "null"], nullable: true },
    assists: { type: ["number", "null"], nullable: true },
    shots: { type: ["number", "null"], nullable: true },
    shotsOnTarget: { type: ["number", "null"], nullable: true },
  },
};

const SCHEMAS = {
  "data/players.json": {
    type: "object",
    properties: {
      players: { type: "array", required: true, items: PLAYER_RECORD },
    },
  },
  "data/legacy-players.json": {
    type: "object",
    properties: {
      players: { type: "array", required: true, items: PLAYER_RECORD },
    },
  },
  "data/fixtures.json": {
    type: "object",
    properties: {
      fixtures: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: ["number", "string"] },
            date: { type: "string" },
            home: { type: "string" },
            away: { type: "string" },
          },
        },
      },
    },
  },
  "data/standings.json": {
    type: "object",
    properties: {
      standings: { type: "object", required: true },
    },
  },
  "data/learn-topics.json": {
    type: "object",
    properties: {
      topics: {
        type: "array",
        required: true,
        items: {
          type: "object",
          properties: {
            slug: { type: "string", required: true },
            title: { type: "string", required: true },
          },
        },
      },
    },
  },
  "data/glossary.json": {
    type: "object",
    properties: {
      terms: { type: "array" },
    },
  },
  "data/sources.json": { type: "object" },
  "data/health.json": { type: "object" },
};

async function main() {
  const errors = [];
  for (const [rel, schema] of Object.entries(SCHEMAS)) {
    const abs = path.join(ROOT, rel);
    let raw;
    try {
      raw = await fs.readFile(abs, "utf-8");
    } catch {
      // Optional files (e.g. health.json before first refresh) are skipped silently.
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      errors.push(fail(rel, `invalid JSON: ${e.message}`));
      continue;
    }
    validateRecord(parsed, schema, errors, rel);
  }

  if (errors.length) {
    console.error("validate-data: SCHEMA VIOLATIONS");
    for (const e of errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(`validate-data: ${Object.keys(SCHEMAS).length} schema(s) OK`);
}

main().catch((err) => {
  console.error("validate-data: fatal", err);
  process.exit(1);
});
