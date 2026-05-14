#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, "schema");
const DATA_DIR = join(__dirname, "..", "data");

const files = [
  { data: join(DATA_DIR, "fuel.json"), schema: join(SCHEMA_DIR, "fuel.schema.json"), label: "fuel.json" },
  { data: join(DATA_DIR, "war_deltas.json"), schema: join(SCHEMA_DIR, "war_deltas.schema.json"), label: "war_deltas.json" },
  { data: join(DATA_DIR, "history.json"), schema: join(SCHEMA_DIR, "history.schema.json"), label: "history.json" },
  { data: join(DATA_DIR, "fx.json"), schema: join(SCHEMA_DIR, "fx.schema.json"), label: "fx.json" },
];

async function loadJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  let anyErr = false;
  for (const f of files) {
    try {
      const [data, schema] = await Promise.all([loadJson(f.data), loadJson(f.schema)]);
      const validate = ajv.compile(schema);
      const ok = validate(data);
      if (!ok) {
        anyErr = true;
        console.error(`FAIL: ${f.label}`);
        for (const e of validate.errors || []) {
          console.error(`  - ${e.instancePath || "/"} ${e.message}`);
        }
      } else {
        console.log(`OK:   ${f.label}`);
      }
    } catch (e) {
      anyErr = true;
      console.error(`FAIL: ${f.label} — ${e.message}`);
    }
  }
  process.exit(anyErr ? 1 : 0);
}

main();
