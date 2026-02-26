import { openDB, type IDBPDatabase } from "idb";
import type { ParsedData } from "../types/canonical";

const DB_NAME = "mkcycles-tally-cache";
const DB_VERSION = 1;
const STORE_NAME = "xml-cache";

interface CacheEntry {
  key: string;           // filename + lastModified timestamp
  data: ParsedData;
  cachedAt: number;      // timestamp
}

let dbInstance: IDBPDatabase | null = null;

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    },
  });

  return dbInstance;
}

export function getCacheKey(fileName: string, lastModified: number): string {
  return `${fileName}|${lastModified}`;
}

export async function getCached(
  fileName: string,
  lastModified: number
): Promise<ParsedData | null> {
  try {
    const db = await getDB();
    const key = getCacheKey(fileName, lastModified);
    const entry = await db.get(STORE_NAME, key) as CacheEntry | undefined;

    if (!entry) return null;

    // Cache is valid if less than 24 hours old
    const age = Date.now() - entry.cachedAt;
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
    if (age > MAX_AGE) {
      await db.delete(STORE_NAME, key);
      return null;
    }

    return entry.data;
  } catch (err) {
    console.error("Cache read failed:", err);
    return null;
  }
}

export async function setCached(
  fileName: string,
  lastModified: number,
  data: ParsedData
): Promise<void> {
  try {
    const db = await getDB();
    const entry: CacheEntry = {
      key: getCacheKey(fileName, lastModified),
      data,
      cachedAt: Date.now(),
    };
    await db.put(STORE_NAME, entry);
  } catch (err) {
    console.error("Cache write failed:", err);
  }
}

export async function clearCache(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
  } catch (err) {
    console.error("Cache clear failed:", err);
  }
}

export async function getAllCachedKeys(): Promise<string[]> {
  try {
    const db = await getDB();
    return await db.getAllKeys(STORE_NAME) as string[];
  } catch (err) {
    console.error("Failed to get cache keys:", err);
    return [];
  }
}
