/**
 * Minimal Meilisearch client over fetch — no SDK dependency.
 *
 * Covers exactly what SundaySong needs: ensure an index, push settings and
 * documents, wait for the async tasks to finish, and search. Mutations in Meili
 * are asynchronous (they return a task id), so callers `waitForTask` before
 * relying on the result.
 */

import { DEFAULT_MEILI_HOST, DEFAULT_MEILI_KEY } from "./config";

export interface EnqueuedTask { taskUid: number; indexUid: string; status: string; type: string; }
export interface TaskView { uid: number; status: "enqueued" | "processing" | "succeeded" | "failed"; error?: { message: string; code: string } | null; }
export interface SearchParams { q: string; filter?: string | string[]; limit?: number; offset?: number; sort?: string[]; attributesToRetrieve?: string[]; }
export interface SearchResult<T> { hits: T[]; estimatedTotalHits: number; query: string; processingTimeMs: number; }

export class MeiliError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "MeiliError";
    this.status = status;
    this.code = code;
  }
}

export class MeiliClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: { host?: string; apiKey?: string } = {}) {
    this.baseUrl = (opts.host ?? process.env.MEILI_HOST ?? DEFAULT_MEILI_HOST).replace(/\/$/, "");
    this.apiKey = opts.apiKey ?? process.env.MEILI_MASTER_KEY ?? DEFAULT_MEILI_KEY;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new MeiliError(res.status, json.code, json.message ?? res.statusText);
    }
    return json as T;
  }

  async health(): Promise<{ status: string }> {
    return this.request("GET", "/health");
  }

  async indexExists(uid: string): Promise<boolean> {
    try {
      await this.request("GET", `/indexes/${uid}`);
      return true;
    } catch (e) {
      if (e instanceof MeiliError && e.status === 404) return false;
      throw e;
    }
  }

  async ensureIndex(uid: string, primaryKey: string): Promise<void> {
    if (await this.indexExists(uid)) return;
    const task = await this.request<EnqueuedTask>("POST", "/indexes", { uid, primaryKey });
    await this.waitForTask(task.taskUid);
  }

  async updateSettings(uid: string, settings: unknown): Promise<EnqueuedTask> {
    return this.request("PATCH", `/indexes/${uid}/settings`, settings);
  }

  async addDocuments(uid: string, docs: unknown[]): Promise<EnqueuedTask> {
    return this.request("PUT", `/indexes/${uid}/documents`, docs);
  }

  async search<T>(uid: string, params: SearchParams): Promise<SearchResult<T>> {
    return this.request("POST", `/indexes/${uid}/search`, params);
  }

  async deleteIndex(uid: string): Promise<void> {
    const task = await this.request<EnqueuedTask>("DELETE", `/indexes/${uid}`);
    await this.waitForTask(task.taskUid);
  }

  /** Poll until a task settles. Throws on failure or timeout. */
  async waitForTask(taskUid: number, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<TaskView> {
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const intervalMs = opts.intervalMs ?? 50;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const task = await this.request<TaskView>("GET", `/tasks/${taskUid}`);
      if (task.status === "succeeded") return task;
      if (task.status === "failed") {
        throw new MeiliError(0, task.error?.code, `task ${taskUid} failed: ${task.error?.message ?? "unknown"}`);
      }
      if (Date.now() > deadline) throw new MeiliError(0, "timeout", `task ${taskUid} did not finish in ${timeoutMs}ms`);
      await Bun.sleep(intervalMs);
    }
  }
}
