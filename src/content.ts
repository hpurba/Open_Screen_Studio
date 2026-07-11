import type { CaptureEvent, CursorKind } from "./shared/types";

type ContentCommand =
  | { type: "CONTENT_PREPARE"; sessionId: string; countdownSeconds?: number }
  | { type: "CONTENT_START"; sessionId: string; startedAt: number }
  | { type: "CONTENT_FLUSH"; sessionId: string }
  | { type: "CONTENT_STOP"; sessionId: string }
  | { type: "CONTENT_CANCEL"; sessionId: string };

type ReadyResponse = {
  active?: boolean;
  sessionId?: string;
  startedAt?: number;
};

type PointerFrame = {
  x: number;
  y: number;
  cursor: CursorKind;
};

const CONTENT_RUNTIME_KEY = "__OPEN_SCREEN_STUDIO_CONTENT_RUNTIME__";
const CURSOR_STYLE_ID = "open-screen-studio-hide-native-cursor";
const COUNTDOWN_HOST_ID = "open-screen-studio-countdown";

function isCommand(value: unknown): value is ContentCommand {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  return [
    "CONTENT_PREPARE",
    "CONTENT_START",
    "CONTENT_FLUSH",
    "CONTENT_STOP",
    "CONTENT_CANCEL"
  ].includes(String((value as { type: unknown }).type));
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function elementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

class ContentCaptureRuntime {
  private sessionId: string | undefined;
  private startedAt: number | undefined;
  private prepared = false;
  private recording = false;
  private stopping = false;
  private cursorStyle: HTMLStyleElement | undefined;
  private countdownHost: HTMLElement | undefined;
  private countdownCancel: (() => void) | undefined;
  private batch: CaptureEvent[] = [];
  private batchTimer: number | undefined;
  private pendingSends = new Set<Promise<void>>();
  private pointerFrame: PointerFrame | undefined;
  private pointerAnimationFrame: number | undefined;
  private lastVisibility: boolean | undefined;
  private pointerInside = true;

  install(): void {
    // A development reload can tear down the old isolated world while leaving
    // extension-owned DOM behind. Never let that strand a hidden page cursor.
    this.restoreNativeCursor();
    this.removeCountdown();

    chrome.runtime.onMessage.addListener(
      (
        message: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void
      ) => {
        if (!isCommand(message)) return false;

        void this.handleCommand(message).then(
          (response) => sendResponse(response),
          (error: unknown) =>
            sendResponse({ ok: false, error: this.errorMessage(error) })
        );
        return true;
      }
    );

    window.addEventListener("pagehide", () => {
      if (this.recording) void this.flushEvents();
    });

    void chrome.runtime
      .sendMessage({ type: "CONTENT_READY" })
      .then((response: ReadyResponse | undefined) => {
        if (
          response?.active &&
          response.sessionId &&
          typeof response.startedAt === "number"
        ) {
          return this.resumeCapture(response.sessionId, response.startedAt);
        }
      })
      .catch(() => {
        // The service worker may still be starting after an extension reload.
      });
  }

  private async handleCommand(
    command: ContentCommand
  ): Promise<Record<string, unknown>> {
    switch (command.type) {
      case "CONTENT_PREPARE":
        return this.prepare(
          command.sessionId,
          Math.max(0, Math.round(command.countdownSeconds ?? 3))
        );
      case "CONTENT_START":
        return this.start(command.sessionId, command.startedAt);
      case "CONTENT_FLUSH":
        await this.flushTelemetry(command.sessionId);
        return { ok: true };
      case "CONTENT_STOP":
        await this.stop(command.sessionId);
        return { ok: true };
      case "CONTENT_CANCEL":
        await this.cancel(command.sessionId);
        return { ok: true };
    }
  }

  private async prepare(
    sessionId: string,
    countdownSeconds: number
  ): Promise<Record<string, unknown>> {
    await this.reset(false);
    this.sessionId = sessionId;

    for (let remaining = countdownSeconds; remaining > 0; remaining -= 1) {
      if (this.sessionId !== sessionId) {
        return { ok: false, error: "Recording countdown was cancelled." };
      }

      await this.showCountdown(remaining);
      void chrome.runtime
        .sendMessage({
          type: "CONTENT_COUNTDOWN_TICK",
          sessionId,
          remaining
        })
        .catch(() => undefined);

      if (!(await this.waitForCountdownTick())) {
        return { ok: false, error: "Recording countdown was cancelled." };
      }
    }

    this.removeCountdown();
    if (this.sessionId !== sessionId) {
      return { ok: false, error: "Recording countdown was cancelled." };
    }

    await this.hideNativeCursor();
    this.prepared = true;
    return {
      ok: true,
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
      dpr: Math.max(1, window.devicePixelRatio || 1)
    };
  }

  private async start(
    sessionId: string,
    startedAt: number
  ): Promise<Record<string, unknown>> {
    if (this.sessionId !== sessionId || !this.prepared) {
      return { ok: false, error: "The page was not prepared for this capture." };
    }
    if (!Number.isFinite(startedAt)) {
      return { ok: false, error: "The recorder supplied an invalid start time." };
    }

    this.startedAt = startedAt;
    this.recording = true;
    this.stopping = false;
    this.pointerInside = true;
    this.addTelemetryListeners();
    this.queueViewport();
    this.queueVisibility(document.visibilityState === "visible");
    return { ok: true };
  }

  private async resumeCapture(
    sessionId: string,
    startedAt: number
  ): Promise<void> {
    await this.reset(false);
    this.sessionId = sessionId;
    await this.hideNativeCursor();
    this.prepared = true;
    await this.start(sessionId, startedAt);
  }

  private async stop(sessionId: string): Promise<void> {
    if (this.sessionId && this.sessionId !== sessionId) return;

    this.cancelCountdown();
    await this.flushTelemetry(sessionId);
    await this.reset(true);
  }

  private async flushTelemetry(sessionId: string): Promise<void> {
    if (this.sessionId && this.sessionId !== sessionId) return;
    if (this.recording) {
      this.stopping = true;
      this.commitPointerFrame();
      this.queueVisibility(false);
      await this.flushEvents();
      await Promise.allSettled([...this.pendingSends]);

      // One retry catches batches returned by a transient service-worker wakeup.
      if (this.batch.length > 0) {
        await this.flushEvents();
        await Promise.allSettled([...this.pendingSends]);
      }
      this.removeTelemetryListeners();
      this.recording = false;
    }
  }

  private async cancel(sessionId: string): Promise<void> {
    if (this.sessionId && this.sessionId !== sessionId) return;
    this.cancelCountdown();
    await this.reset(true);
  }

  private async reset(clearEvents: boolean): Promise<void> {
    this.cancelCountdown();
    this.removeCountdown();
    this.removeTelemetryListeners();
    this.restoreNativeCursor();

    if (this.batchTimer !== undefined) {
      window.clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    if (this.pointerAnimationFrame !== undefined) {
      window.cancelAnimationFrame(this.pointerAnimationFrame);
      this.pointerAnimationFrame = undefined;
    }

    this.sessionId = undefined;
    this.startedAt = undefined;
    this.prepared = false;
    this.recording = false;
    this.stopping = false;
    this.pointerFrame = undefined;
    this.lastVisibility = undefined;
    if (clearEvents) this.batch = [];
  }

  private addTelemetryListeners(): void {
    window.addEventListener("pointermove", this.onPointerMove, {
      capture: true,
      passive: true
    });
    window.addEventListener("click", this.onClick, {
      capture: true,
      passive: true
    });
    window.addEventListener("pointerover", this.onPointerEnter, {
      capture: true,
      passive: true
    });
    window.addEventListener("pointerout", this.onPointerLeave, {
      capture: true,
      passive: true
    });
    window.addEventListener("resize", this.onViewportChange, { passive: true });
    window.visualViewport?.addEventListener("resize", this.onViewportChange, {
      passive: true
    });
    document.addEventListener("visibilitychange", this.onVisibilityChange, {
      passive: true
    });
  }

  private removeTelemetryListeners(): void {
    window.removeEventListener("pointermove", this.onPointerMove, true);
    window.removeEventListener("click", this.onClick, true);
    window.removeEventListener("pointerover", this.onPointerEnter, true);
    window.removeEventListener("pointerout", this.onPointerLeave, true);
    window.removeEventListener("resize", this.onViewportChange);
    window.visualViewport?.removeEventListener("resize", this.onViewportChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.recording || this.stopping) return;
    this.pointerInside = true;
    this.queueVisibility(document.visibilityState === "visible");
    this.pointerFrame = {
      x: clampUnit(event.clientX / Math.max(1, window.innerWidth)),
      y: clampUnit(event.clientY / Math.max(1, window.innerHeight)),
      cursor: this.cursorKind(elementFromTarget(event.target))
    };

    if (this.pointerAnimationFrame === undefined) {
      this.pointerAnimationFrame = window.requestAnimationFrame(() => {
        this.pointerAnimationFrame = undefined;
        this.commitPointerFrame();
      });
    }
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (!this.recording || this.stopping) return;
    this.commitPointerFrame();
    this.queueEvent({
      type: "click",
      t: this.captureTime(),
      x: clampUnit(event.clientX / Math.max(1, window.innerWidth)),
      y: clampUnit(event.clientY / Math.max(1, window.innerHeight)),
      button: Number.isFinite(event.button) ? event.button : 0
    });
  };

  private readonly onPointerEnter = (event: PointerEvent): void => {
    if (event.relatedTarget !== null || !this.recording) return;
    this.pointerInside = true;
    this.queueVisibility(document.visibilityState === "visible");
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.relatedTarget !== null || !this.recording) return;
    this.pointerInside = false;
    this.queueVisibility(false);
  };

  private readonly onViewportChange = (): void => {
    if (this.recording && !this.stopping) this.queueViewport();
  };

  private readonly onVisibilityChange = (): void => {
    if (!this.recording) return;
    this.queueVisibility(
      document.visibilityState === "visible" && this.pointerInside
    );
  };

  private commitPointerFrame(): void {
    if (!this.pointerFrame || !this.recording) return;
    this.queueEvent({
      type: "pointer",
      t: this.captureTime(),
      ...this.pointerFrame
    });
    this.pointerFrame = undefined;
  }

  private queueViewport(): void {
    this.queueEvent({
      type: "viewport",
      t: this.captureTime(),
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
      dpr: Math.max(0.1, window.devicePixelRatio || 1)
    });
  }

  private queueVisibility(visible: boolean): void {
    if (this.lastVisibility === visible) return;
    this.lastVisibility = visible;
    this.queueEvent({ type: "visibility", t: this.captureTime(), visible });
  }

  private queueEvent(event: CaptureEvent): void {
    if (!this.sessionId || this.startedAt === undefined) return;
    this.batch.push(event);
    if (this.batch.length >= 64) {
      void this.flushEvents();
      return;
    }
    if (this.batchTimer === undefined) {
      this.batchTimer = window.setTimeout(() => {
        this.batchTimer = undefined;
        void this.flushEvents();
      }, 100);
    }
  }

  private async flushEvents(): Promise<void> {
    if (this.batchTimer !== undefined) {
      window.clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    if (!this.sessionId || this.batch.length === 0) return;

    const sessionId = this.sessionId;
    const events = this.batch.splice(0, this.batch.length);
    let tracked: Promise<void>;
    tracked = chrome.runtime
      .sendMessage({ type: "CONTENT_EVENT_BATCH", sessionId, events })
      .then((response: { ok?: boolean; error?: string } | undefined) => {
        if (!response?.ok) {
          throw new Error(response?.error || "The recorder rejected page events.");
        }
      })
      .catch(() => {
        if (this.sessionId === sessionId && this.recording) {
          this.batch.unshift(...events);
        }
      })
      .finally(() => this.pendingSends.delete(tracked));
    this.pendingSends.add(tracked);
    await tracked;
  }

  private captureTime(): number {
    return Math.max(0, Date.now() - (this.startedAt ?? Date.now()));
  }

  private cursorKind(target: Element | null): CursorKind {
    let cursor = "default";
    const style = this.cursorStyle;
    try {
      if (style) style.disabled = true;
      cursor = target ? getComputedStyle(target).cursor : "default";
    } catch {
      cursor = "default";
    } finally {
      if (style) style.disabled = false;
    }

    if (cursor === "none") return "hidden";
    if (cursor === "pointer") return "pointer";
    if (cursor === "text" || cursor === "vertical-text") return "text";
    if (cursor === "grab") return "grab";
    if (cursor === "grabbing") return "grabbing";
    if (cursor === "crosshair" || cursor === "cell") return "crosshair";
    return "default";
  }

  private async hideNativeCursor(): Promise<void> {
    await this.ensureDocumentElement();
    this.restoreNativeCursor();
    const style = document.createElement("style");
    style.id = CURSOR_STYLE_ID;
    style.textContent = "html, html *, body, body * { cursor: none !important; }";
    document.documentElement.append(style);
    this.cursorStyle = style;
  }

  private restoreNativeCursor(): void {
    this.cursorStyle?.remove();
    this.cursorStyle = undefined;
    document.getElementById(CURSOR_STYLE_ID)?.remove();
  }

  private async showCountdown(value: number): Promise<void> {
    await this.ensureDocumentElement();
    let host = this.countdownHost;
    if (!host) {
      host = document.createElement("div");
      host.id = COUNTDOWN_HOST_ID;
      host.setAttribute("aria-hidden", "true");
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .backdrop {
            position: fixed; inset: 0; z-index: 2147483647;
            display: grid; place-items: center; pointer-events: none;
            background: rgba(4, 7, 18, .16);
          }
          .count {
            display: grid; place-items: center; width: 112px; height: 112px;
            border: 2px solid rgba(255,255,255,.82); border-radius: 999px;
            color: white; background: rgba(10, 13, 26, .84);
            box-shadow: 0 18px 70px rgba(0,0,0,.38);
            font: 700 52px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            text-shadow: 0 2px 12px rgba(0,0,0,.35);
          }
        </style>
        <div class="backdrop"><div class="count"></div></div>
      `;
      document.documentElement.append(host);
      this.countdownHost = host;
    }
    const count = host.shadowRoot?.querySelector<HTMLElement>(".count");
    if (count) count.textContent = String(value);
  }

  private removeCountdown(): void {
    this.countdownHost?.remove();
    this.countdownHost = undefined;
    document.getElementById(COUNTDOWN_HOST_ID)?.remove();
  }

  private waitForCountdownTick(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (completed: boolean): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (this.countdownCancel === cancel) this.countdownCancel = undefined;
        resolve(completed);
      };
      const timer = window.setTimeout(() => finish(true), 1_000);
      const cancel = (): void => finish(false);
      this.countdownCancel = cancel;
    });
  }

  private cancelCountdown(): void {
    this.countdownCancel?.();
    this.countdownCancel = undefined;
  }

  private ensureDocumentElement(): Promise<void> {
    if (document.documentElement) return Promise.resolve();
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.documentElement) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(document, { childList: true });
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

type ContentWindow = Window &
  typeof globalThis & {
    [CONTENT_RUNTIME_KEY]?: ContentCaptureRuntime;
  };

const contentWindow = window as ContentWindow;
if (!contentWindow[CONTENT_RUNTIME_KEY]) {
  const runtime = new ContentCaptureRuntime();
  contentWindow[CONTENT_RUNTIME_KEY] = runtime;
  runtime.install();
}
