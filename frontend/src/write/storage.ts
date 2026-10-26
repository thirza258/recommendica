/**
 * Document persistence in this browser.
 *
 * IndexedDB rather than localStorage: papers carry images, and localStorage
 * is a few megabytes of synchronous strings. Summaries live in their own
 * store so the documents list never loads every paper's images.
 *
 * When IndexedDB is unavailable (some private modes, blocked site data) the
 * store falls back to memory and says so through `persistent`, so the UI can
 * warn that work will not survive a reload.
 */

import { normalizeDocument, normalizeSummary, summarize } from "./documents.ts";
import type { DocumentSummary, PaperDocument } from "./documents.ts";

export interface DocumentStore {
  readonly persistent: boolean;
  list(): Promise<DocumentSummary[]>;
  get(id: string): Promise<PaperDocument | null>;
  put(doc: PaperDocument): Promise<void>;
  remove(id: string): Promise<void>;
  /** Called with a document id when another tab saves or deletes it. */
  subscribe(listener: (id: string) => void): () => void;
}

const DB_NAME = "recommendica-write";
const DB_VERSION = 1;
const DOCUMENTS = "documents";
const SUMMARIES = "summaries";
const CHANNEL = "recommendica-write";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("The save was aborted."));
  });
}

function bySavedTime(a: DocumentSummary, b: DocumentSummary): number {
  return b.updatedAt - a.updatedAt;
}

class Broadcast {
  private channel: BroadcastChannel | null = null;
  private readonly listeners = new Set<(id: string) => void>();

  constructor() {
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data === "string") this.listeners.forEach((listener) => listener(event.data as string));
      };
    } catch {
      this.channel = null;
    }
  }

  post(id: string): void {
    try {
      this.channel?.postMessage(id);
    } catch {
      // Cross-tab notice only; saving already succeeded.
    }
  }

  subscribe(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

class IndexedDbStore implements DocumentStore {
  readonly persistent = true;
  private readonly db: IDBDatabase;
  private readonly broadcast = new Broadcast();
  private askedForPersistence = false;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  async list(): Promise<DocumentSummary[]> {
    const transaction = this.db.transaction(SUMMARIES, "readonly");
    const rows = await promisify(transaction.objectStore(SUMMARIES).getAll());
    return rows.map(normalizeSummary).filter((row): row is DocumentSummary => row !== null).sort(bySavedTime);
  }

  async get(id: string): Promise<PaperDocument | null> {
    const transaction = this.db.transaction(DOCUMENTS, "readonly");
    return normalizeDocument(await promisify(transaction.objectStore(DOCUMENTS).get(id)));
  }

  async put(doc: PaperDocument): Promise<void> {
    const transaction = this.db.transaction([DOCUMENTS, SUMMARIES], "readwrite");
    transaction.objectStore(DOCUMENTS).put(doc);
    transaction.objectStore(SUMMARIES).put(summarize(doc));
    await completion(transaction);
    this.broadcast.post(doc.id);
    if (!this.askedForPersistence) {
      this.askedForPersistence = true;
      // Ask the browser not to evict papers under storage pressure. Optional.
      void navigator.storage?.persist?.().catch(() => undefined);
    }
  }

  async remove(id: string): Promise<void> {
    const transaction = this.db.transaction([DOCUMENTS, SUMMARIES], "readwrite");
    transaction.objectStore(DOCUMENTS).delete(id);
    transaction.objectStore(SUMMARIES).delete(id);
    await completion(transaction);
    this.broadcast.post(id);
  }

  subscribe(listener: (id: string) => void): () => void {
    return this.broadcast.subscribe(listener);
  }
}

class MemoryStore implements DocumentStore {
  readonly persistent = false;
  private readonly docs = new Map<string, PaperDocument>();

  async list(): Promise<DocumentSummary[]> {
    return [...this.docs.values()].map(summarize).sort(bySavedTime);
  }

  async get(id: string): Promise<PaperDocument | null> {
    const doc = this.docs.get(id);
    return doc ? structuredClone(doc) : null;
  }

  async put(doc: PaperDocument): Promise<void> {
    this.docs.set(doc.id, structuredClone(doc));
  }

  async remove(id: string): Promise<void> {
    this.docs.delete(id);
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    const timer = setTimeout(() => reject(new Error("Opening browser storage timed out.")), 5000);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS)) db.createObjectStore(DOCUMENTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: "id" });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error("Browser storage could not be opened."));
    };
    request.onblocked = () => {
      clearTimeout(timer);
      reject(new Error("Browser storage is blocked by another tab."));
    };
  });
}

let storePromise: Promise<DocumentStore> | null = null;

export function openDocumentStore(): Promise<DocumentStore> {
  if (!storePromise) {
    storePromise = openDatabase()
      .then((db) => new IndexedDbStore(db) as DocumentStore)
      .catch(() => new MemoryStore());
  }
  return storePromise;
}
