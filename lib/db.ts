export interface Env {
  email_db: D1Database;
  ASSETS: Fetcher;
}

let current: Env | null = null;

export function setEnv(e: Env): void {
  current = e;
}

export function env(): Env {
  if (!current) throw new Error("Worker env not initialised");
  return current;
}

export function db(): D1Database {
  return env().email_db;
}

export async function getConfig<T>(key: string): Promise<T | null> {
  const row = await db().prepare("SELECT value FROM config WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function putConfig(key: string, value: unknown): Promise<void> {
  await db()
    .prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(value))
    .run();
}
