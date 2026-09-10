import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * A two-line key-value store with two backends.
 *
 * Local development gets a JSON file, which is inspectable and survives a
 * restart. A serverless deployment gets Redis over HTTP, because the filesystem
 * there is read-only — writing to it throws EROFS, and even /tmp is per-instance
 * and wiped between invocations, so a file-backed store on Vercel silently
 * loses every application.
 *
 * Redis over its REST API rather than a client library: serverless functions
 * cannot hold a TCP connection pool across invocations, and this needs no
 * dependency at all — it is two fetches.
 *
 * Configure by setting either pair (Vercel's Upstash integration sets the KV_
 * ones for you):
 *   KV_REST_API_URL + KV_REST_API_TOKEN
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 */

type RedisConfig = { url: string; token: string };

function redisConfig(): RedisConfig | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

/** True when a durable backend is configured — surfaced in the UI as a warning. */
export function hasDurableStore(): boolean {
  return redisConfig() !== null;
}

export function storeKind(): "redis" | "file" {
  return redisConfig() ? "redis" : "file";
}

function filePath(): string {
  const dir = process.env.GRANTLANE_DATA_DIR ?? join(process.cwd(), ".data");
  return join(dir, "store.json");
}

function readFileDb(): Record<string, string> {
  try {
    const path = filePath();
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    // A corrupt file should not take the app down; start clean rather than throw.
    return {};
  }
}

function writeFileDb(db: Record<string, string>): void {
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(db, null, 2));
}

async function redisCommand<T>(config: RedisConfig, command: unknown[]): Promise<T> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Redis ${command[0]} failed: ${response.status} ${await response.text().catch(() => "")}`);
  }

  const body = (await response.json()) as { result: T };
  return body.result;
}

export async function kvGet(key: string): Promise<string | null> {
  const config = redisConfig();
  if (!config) return readFileDb()[key] ?? null;
  return redisCommand<string | null>(config, ["GET", key]);
}

export async function kvSet(key: string, value: string): Promise<void> {
  const config = redisConfig();
  if (!config) {
    const db = readFileDb();
    db[key] = value;
    writeFileDb(db);
    return;
  }
  await redisCommand(config, ["SET", key, value]);
}
