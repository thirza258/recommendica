/**
 * Client for the LaTeX render worker.
 *
 * One worker per editor. A render that runs too long (a pathological table,
 * a huge pasted file) is abandoned and the worker replaced, so the preview
 * can recover without a reload. Where workers are unavailable the renderer
 * runs on the main thread instead.
 */

import type { RenderOptions, RenderResult } from "../latex/render.ts";

const TIMEOUT_MS = 15_000;

interface Pending {
  resolve: (result: RenderResult) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class RenderService {
  private worker: Worker | null = null;
  private unavailable = false;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();

  private start(): Worker | null {
    if (this.worker || this.unavailable) return this.worker;
    try {
      const worker = new Worker(new URL("../latex/render.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ id: number; result?: RenderResult; error?: string }>) => {
        const entry = this.pending.get(event.data.id);
        if (!entry) return;
        this.pending.delete(event.data.id);
        window.clearTimeout(entry.timer);
        if (event.data.result) entry.resolve(event.data.result);
        else entry.reject(new Error(event.data.error ?? "The preview could not be rendered."));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        this.unavailable = true;
        this.stop(new Error("The preview worker stopped."));
      };
      this.worker = worker;
    } catch {
      this.unavailable = true;
    }
    return this.worker;
  }

  private stop(reason: Error): void {
    this.worker?.terminate();
    this.worker = null;
    for (const entry of this.pending.values()) {
      window.clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.pending.clear();
  }

  async render(source: string, options: RenderOptions): Promise<RenderResult> {
    const worker = this.start();
    if (!worker) {
      const { renderLatex } = await import("../latex/render.ts");
      return renderLatex(source, options);
    }
    const id = ++this.sequence;
    return new Promise<RenderResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.stop(new Error("Rendering took too long. Simplify the last change or split the document with \\input."));
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, source, options });
    });
  }

  dispose(): void {
    this.stop(new Error("The editor was closed."));
  }
}
