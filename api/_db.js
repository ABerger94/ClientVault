import { sql } from "@vercel/postgres";
import { get, put } from "@vercel/blob";

const STATE_ID = "default";
const STATE_PATH = "crm/state.json";
const AUDIT_PATH = "crm/audit.json";

export function hasDatabase() {
  return Boolean(process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING);
}

export function blankData() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    clients: [],
    contacts: [],
    deals: [],
    projects: [],
    tasks: [],
    onboarding: [],
    questionnaires: [],
    meetings: [],
    notes: [],
    audit: [],
  };
}

export function hydrateData(data) {
  return { ...blankData(), ...(data || {}) };
}

export async function ensureSchema() {
  if (!hasDatabase()) throw new Error("POSTGRES_URL is not configured");
  await sql`
    CREATE TABLE IF NOT EXISTS clientvault_state (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS clientvault_kv (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS clientvault_audit_events (
      id bigserial PRIMARY KEY,
      actor text NOT NULL,
      action text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function readCrmData() {
  if (!hasDatabase()) {
    const data = await readBlobJson(STATE_PATH, null);
    if (data) return hydrateData(data);
    const initial = blankData();
    await writeCrmData(initial, "system", "Initialized CRM store");
    return initial;
  }
  await ensureSchema();
  const result = await sql`SELECT data FROM clientvault_state WHERE id = ${STATE_ID}`;
  if (!result.rows.length) {
    const data = blankData();
    await writeCrmData(data, "system", "Initialized CRM database");
    return data;
  }
  return hydrateData(result.rows[0].data);
}

export async function writeCrmData(data, actor = "admin", action = "Saved CRM data") {
  if (!hasDatabase()) {
    const hydrated = hydrateData(data);
    hydrated.updatedAt = new Date().toISOString();
    await writeBlobJson(STATE_PATH, hydrated);
    await appendAudit(actor, action, { source: "crm" });
    return hydrated;
  }
  await ensureSchema();
  const hydrated = hydrateData(data);
  hydrated.updatedAt = new Date().toISOString();
  await sql`
    INSERT INTO clientvault_state (id, data, updated_at)
    VALUES (${STATE_ID}, ${JSON.stringify(hydrated)}::jsonb, now())
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `;
  await appendAudit(actor, action, { source: "crm" });
  return hydrated;
}

export async function readKv(key, fallback = null) {
  if (!hasDatabase()) return await readBlobJson(key, fallback);
  await ensureSchema();
  const result = await sql`SELECT value FROM clientvault_kv WHERE key = ${key}`;
  return result.rows.length ? result.rows[0].value : fallback;
}

export async function writeKv(key, value) {
  if (!hasDatabase()) {
    await writeBlobJson(key, value);
    return;
  }
  await ensureSchema();
  await sql`
    INSERT INTO clientvault_kv (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

export async function appendAudit(actor, action, metadata = {}) {
  if (!hasDatabase()) {
    const audit = await readBlobJson(AUDIT_PATH, { events: [] });
    audit.events.unshift({ actor, action, metadata, createdAt: new Date().toISOString() });
    audit.events = audit.events.slice(0, 500);
    await writeBlobJson(AUDIT_PATH, audit);
    return;
  }
  await ensureSchema();
  await sql`
    INSERT INTO clientvault_audit_events (actor, action, metadata)
    VALUES (${actor}, ${action}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

async function readBlobJson(path, fallback = null) {
  try {
    const blob = await get(path);
    const response = await fetch(blob.downloadUrl || blob.url);
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

async function writeBlobJson(path, value) {
  await put(path, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}
