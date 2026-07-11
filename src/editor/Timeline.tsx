import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Project } from "../shared/types";
import type { EditorSelection } from "./editorTypes";
import { Icon } from "./icons";
import { clamp, createId, formatDuration, nearestCursorPoint } from "./utils";

type TimelineProps = {
  project: Project;
  time: number;
  selection: EditorSelection;
  setProject: Dispatch<SetStateAction<Project>>;
  onTimeChange: (time: number) => void;
  onSelectionChange: (selection: EditorSelection) => void;
  onRequestTarget: (zoomId: string) => void;
};

type Drag = {
  kind: "zoom" | "hidden";
  id: string;
  mode: "move" | "start" | "end";
  originX: number;
  originStart: number;
  originEnd: number;
  trackWidth: number;
};

const MIN_SEGMENT = 180;

export function Timeline({
  project,
  time,
  selection,
  setProject,
  onTimeChange,
  onSelectionChange,
  onRequestTarget,
}: TimelineProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(1, project.duration);
  const timePercent = `${(clamp(time, 0, duration) / duration) * 100}%`;
  const clicks = useMemo(
    () => project.events.filter((event) => event.type === "click"),
    [project.events],
  );
  const ticks = useMemo(() => {
    const count = 8;
    return Array.from({ length: count + 1 }, (_, index) => (duration * index) / count);
  }, [duration]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const delta = ((event.clientX - drag.originX) / drag.trackWidth) * duration;
      const updateRange = (start: number, end: number) => {
        if (drag.mode === "start") {
          return { start: clamp(drag.originStart + delta, 0, end - MIN_SEGMENT), end };
        }
        if (drag.mode === "end") {
          return { start, end: clamp(drag.originEnd + delta, start + MIN_SEGMENT, duration) };
        }
        const length = drag.originEnd - drag.originStart;
        const nextStart = clamp(drag.originStart + delta, 0, duration - length);
        return { start: nextStart, end: nextStart + length };
      };
      setProject((current) => {
        if (drag.kind === "zoom") {
          return {
            ...current,
            zooms: current.zooms.map((segment) =>
              segment.id === drag.id ? { ...segment, ...updateRange(segment.start, segment.end) } : segment,
            ),
          };
        }
        return {
          ...current,
          hiddenCursorRanges: current.hiddenCursorRanges.map((range) =>
            range.id === drag.id ? { ...range, ...updateRange(range.start, range.end) } : range,
          ),
        };
      });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    document.body.classList.add("is-timeline-dragging");
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("is-timeline-dragging");
    };
  }, [drag, duration, setProject]);

  const seekFromPointer = (event: React.PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    onTimeChange(clamp(((event.clientX - bounds.left) / bounds.width) * duration, 0, duration));
  };

  const beginDrag = (
    event: React.PointerEvent,
    kind: Drag["kind"],
    id: string,
    mode: Drag["mode"],
    start: number,
    end: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const track = (event.currentTarget as HTMLElement).closest(".timeline-track") as HTMLElement | null;
    if (!track) return;
    onSelectionChange({ kind, id });
    setDrag({
      kind,
      id,
      mode,
      originX: event.clientX,
      originStart: start,
      originEnd: end,
      trackWidth: Math.max(1, track.getBoundingClientRect().width),
    });
  };

  const nudge = (kind: Drag["kind"], id: string, delta: number) => {
    setProject((current) => {
      const move = <T extends { id: string; start: number; end: number }>(item: T) => {
        if (item.id !== id) return item;
        const length = item.end - item.start;
        const start = clamp(item.start + delta, 0, duration - length);
        return { ...item, start, end: start + length };
      };
      return kind === "zoom"
        ? { ...current, zooms: current.zooms.map(move) }
        : { ...current, hiddenCursorRanges: current.hiddenCursorRanges.map(move) };
    });
  };

  const onBlockKey = (event: React.KeyboardEvent, kind: Drag["kind"], id: string) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      nudge(kind, id, event.key === "ArrowLeft" ? -100 : 100);
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      setProject((current) =>
        kind === "zoom"
          ? { ...current, zooms: current.zooms.filter((item) => item.id !== id) }
          : {
              ...current,
              hiddenCursorRanges: current.hiddenCursorRanges.filter((item) => item.id !== id),
            },
      );
      onSelectionChange(null);
    }
  };

  const addZoom = () => {
    const length = Math.min(2400, Math.max(MIN_SEGMENT, project.trimEnd - project.trimStart));
    const start = clamp(time - 150, project.trimStart, Math.max(project.trimStart, project.trimEnd - length));
    const id = createId("zoom");
    setProject((current) => ({
      ...current,
      zooms: [
        ...current.zooms,
        {
          id,
          kind: "manual" as const,
          start,
          end: Math.min(project.trimEnd, start + length),
          scale: 1.8,
          target: nearestCursorPoint(current, time),
          follow: false,
        },
      ].sort((a, b) => a.start - b.start),
    }));
    onSelectionChange({ kind: "zoom", id });
    onRequestTarget(id);
  };

  const addHidden = () => {
    const length = Math.min(2000, Math.max(MIN_SEGMENT, project.trimEnd - project.trimStart));
    const start = clamp(time, project.trimStart, Math.max(project.trimStart, project.trimEnd - length));
    const id = createId("hidden");
    setProject((current) => ({
      ...current,
      hiddenCursorRanges: [
        ...current.hiddenCursorRanges,
        { id, start, end: Math.min(project.trimEnd, start + length) },
      ].sort((a, b) => a.start - b.start),
    }));
    onSelectionChange({ kind: "hidden", id });
  };

  const trimStartPercent = (project.trimStart / duration) * 100;
  const trimEndPercent = (project.trimEnd / duration) * 100;

  return (
    <section className="timeline-panel" aria-label="Recording timeline">
      <div className="timeline-toolbar">
        <div className="timeline-title-group">
          <strong>Timeline</strong>
          <span>{formatDuration(project.trimEnd - project.trimStart)} selected</span>
        </div>
        <div className="timeline-actions">
          <button className="button button-compact" onClick={addZoom} aria-label="Add manual zoom at playhead">
            <Icon name="zoom-in" size={15} /> Add zoom
          </button>
          <button className="button button-compact" onClick={addHidden} aria-label="Hide cursor in a new range">
            <Icon name="eye-off" size={15} /> Hide cursor
          </button>
        </div>
      </div>

      <div className="timeline-grid">
        <div className="timeline-label ruler-label">Time</div>
        <div
          ref={rulerRef}
          className="timeline-ruler"
          onPointerDown={seekFromPointer}
          aria-label="Seek recording"
        >
          <span className="trim-shade trim-shade-start" style={{ width: `${trimStartPercent}%` }} />
          <span
            className="trim-shade trim-shade-end"
            style={{ left: `${trimEndPercent}%`, right: 0 }}
          />
          {ticks.map((tick) => (
            <span className="ruler-tick" key={tick} style={{ left: `${(tick / duration) * 100}%` }}>
              <i />
              <small>{formatDuration(tick)}</small>
            </span>
          ))}
          {clicks.map((click, index) => (
            <button
              key={`${click.t}-${index}`}
              className="click-marker"
              style={{ left: `${(click.t / duration) * 100}%` }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onTimeChange(click.t)}
              title={`Click at ${formatDuration(click.t, true)}`}
              aria-label={`Go to click at ${formatDuration(click.t, true)}`}
            />
          ))}
          <span className="timeline-playhead ruler-playhead" style={{ left: timePercent }} />
        </div>

        <div className="timeline-label"><Icon name="zoom-in" size={15} /><span>Zoom</span></div>
        <div className="timeline-track zoom-track" onPointerDown={seekFromPointer}>
          {project.zooms.length === 0 && <span className="empty-track-hint">No zooms yet</span>}
          {project.zooms.map((segment) => {
            const selected = selection?.kind === "zoom" && selection.id === segment.id;
            return (
              <div
                key={segment.id}
                className={`timeline-block zoom-block ${segment.kind}${selected ? " selected" : ""}`}
                style={{
                  left: `${(segment.start / duration) * 100}%`,
                  width: `${Math.max(0.35, ((segment.end - segment.start) / duration) * 100)}%`,
                }}
                role="button"
                tabIndex={0}
                aria-label={`${segment.kind} zoom from ${formatDuration(segment.start, true)} to ${formatDuration(segment.end, true)}`}
                onPointerDown={(event) => beginDrag(event, "zoom", segment.id, "move", segment.start, segment.end)}
                onKeyDown={(event) => onBlockKey(event, "zoom", segment.id)}
              >
                <span
                  className="resize-handle start"
                  onPointerDown={(event) => beginDrag(event, "zoom", segment.id, "start", segment.start, segment.end)}
                />
                <span className="block-content">
                  <Icon name={segment.kind === "auto" ? "sparkles" : "zoom-in"} size={12} />
                  <span>{segment.kind === "auto" ? "Auto" : `${segment.scale.toFixed(1)}×`}</span>
                </span>
                <span
                  className="resize-handle end"
                  onPointerDown={(event) => beginDrag(event, "zoom", segment.id, "end", segment.start, segment.end)}
                />
              </div>
            );
          })}
          <span className="timeline-playhead" style={{ left: timePercent }} />
        </div>

        <div className="timeline-label"><Icon name="eye-off" size={15} /><span>Cursor</span></div>
        <div className="timeline-track hidden-track" onPointerDown={seekFromPointer}>
          {project.hiddenCursorRanges.length === 0 && (
            <span className="empty-track-hint">Cursor stays visible</span>
          )}
          {project.hiddenCursorRanges.map((range) => {
            const selected = selection?.kind === "hidden" && selection.id === range.id;
            return (
              <div
                key={range.id}
                className={`timeline-block hidden-block${selected ? " selected" : ""}`}
                style={{
                  left: `${(range.start / duration) * 100}%`,
                  width: `${Math.max(0.35, ((range.end - range.start) / duration) * 100)}%`,
                }}
                role="button"
                tabIndex={0}
                aria-label={`Cursor hidden from ${formatDuration(range.start, true)} to ${formatDuration(range.end, true)}`}
                onPointerDown={(event) => beginDrag(event, "hidden", range.id, "move", range.start, range.end)}
                onKeyDown={(event) => onBlockKey(event, "hidden", range.id)}
              >
                <span
                  className="resize-handle start"
                  onPointerDown={(event) => beginDrag(event, "hidden", range.id, "start", range.start, range.end)}
                />
                <span className="block-content"><Icon name="eye-off" size={12} /><span>Hidden</span></span>
                <span
                  className="resize-handle end"
                  onPointerDown={(event) => beginDrag(event, "hidden", range.id, "end", range.start, range.end)}
                />
              </div>
            );
          })}
          <span className="timeline-playhead" style={{ left: timePercent }} />
        </div>
      </div>
    </section>
  );
}
