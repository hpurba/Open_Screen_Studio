import { useEffect, useState } from "react";
import { normalizeProject } from "../shared/project";
import type { Point, Project } from "../shared/types";
import { CanvasPreview } from "./CanvasPreview";
import type { EditorSelection } from "./editorTypes";
import { downloadExport, exportProject } from "./exporter";
import { BrandMark, Icon } from "./icons";
import { Inspector } from "./Inspector";
import { Library } from "./Library";
import { projectStore } from "./storageAdapter";
import { Timeline } from "./Timeline";
import { Transport } from "./Transport";
import { useAutosave } from "./useAutosave";
import { clamp, formatDuration, safeHost } from "./utils";

const projectIdFromLocation = () => {
  const hashMatch = window.location.hash.match(/^#\/project\/([^/?]+)/);
  if (hashMatch) return decodeURIComponent(hashMatch[1]);
  return new URLSearchParams(window.location.search).get("project");
};

const goToProject = (projectId: string | null) => {
  window.location.hash = projectId ? `/project/${encodeURIComponent(projectId)}` : "/";
};

export function App() {
  const [projectId, setProjectId] = useState(projectIdFromLocation);
  useEffect(() => {
    const update = () => setProjectId(projectIdFromLocation());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return projectId ? (
    <ProjectLoader projectId={projectId} onBack={() => goToProject(null)} />
  ) : (
    <Library onOpenProject={(id) => goToProject(id)} />
  );
}

function ProjectLoader({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [data, setData] = useState<{ project: Project; recording: Blob | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    Promise.all([projectStore.get(projectId), projectStore.getRecording(projectId)])
      .then(([project, recording]) => {
        if (!active) return;
        if (!project) throw new Error("missing");
        setData({
          project: normalizeProject(project),
          recording: recording?.size ? recording : null,
        });
      })
      .catch(() => active && setError("This project could not be found in local storage."));
    return () => {
      active = false;
    };
  }, [projectId]);

  if (error) {
    return (
      <main className="load-error">
        <BrandMark size={42} /><h1>Project unavailable</h1><p>{error}</p>
        <button className="primary-button" onClick={onBack}><Icon name="arrow-left" /> Back to library</button>
      </main>
    );
  }
  if (!data) {
    return <main className="editor-loading"><BrandMark size={38} /><span className="loading-spinner" /><p>Opening your recording…</p></main>;
  }
  return <EditorWorkspace key={data.project.id} initialProject={data.project} recording={data.recording} onBack={onBack} />;
}

type ExportState =
  | { status: "idle" }
  | {
      status: "running";
      phase: "render" | "transcode";
      progress: number;
      controller: AbortController;
    }
  | { status: "error"; message: string }
  | { status: "done" };

function EditorWorkspace({
  initialProject,
  recording,
  onBack,
}: {
  initialProject: Project;
  recording: Blob | null;
  onBack: () => void;
}) {
  const [project, setProject] = useState(initialProject);
  const [time, setTime] = useState(initialProject.trimStart);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<EditorSelection>(null);
  const [targetZoomId, setTargetZoomId] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const saveState = useAutosave(project);

  const setCurrentTime = (next: number) => setTime(clamp(next, project.trimStart, project.trimEnd));
  const pickTarget = (target: Point) => {
    if (!targetZoomId) return;
    setProject((current) => ({
      ...current,
      zooms: current.zooms.map((zoom) => (zoom.id === targetZoomId ? { ...zoom, target } : zoom)),
    }));
    setTargetZoomId(null);
  };

  useEffect(() => {
    if (time < project.trimStart) setTime(project.trimStart);
    if (time > project.trimEnd) setTime(project.trimEnd);
  }, [project.trimEnd, project.trimStart, time]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable=true]")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((current) => !current);
      }
      if (event.key === "Escape") setTargetZoomId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const beginExport = async () => {
    if (!recording) {
      setExportState({ status: "error", message: "The source recording is missing, so this project cannot be exported." });
      return;
    }
    setPlaying(false);
    const controller = new AbortController();
    setExportState({ status: "running", phase: "render", progress: 0, controller });
    try {
      const result = await exportProject({
        project,
        recording,
        signal: controller.signal,
        onProgress: ({ phase, progress }) =>
          setExportState({ status: "running", phase, progress, controller }),
      });
      await downloadExport(result.blob, result.filename);
      setExportState({ status: "done" });
      window.setTimeout(() => setExportState((current) => current.status === "done" ? { status: "idle" } : current), 3500);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setExportState({ status: "idle" });
      } else {
        setExportState({ status: "error", message: error instanceof Error ? error.message : "Export failed. Please try again." });
      }
    }
  };

  const requestTarget = (zoomId: string) => {
    setSelection({ kind: "zoom", id: zoomId });
    setPlaying(false);
    setTargetZoomId(zoomId);
  };

  return (
    <div className="editor-page">
      <header className="editor-header">
        <div className="editor-header-left">
          <button className="icon-button back-button" onClick={onBack} aria-label="Back to project library"><Icon name="arrow-left" size={19} /></button>
          <BrandMark size={26} />
          <span className="header-divider" />
          <div className="title-stack">
            <input className="project-title-input" value={project.title} onChange={(event) => setProject((current) => ({ ...current, title: event.target.value }))} aria-label="Project title" />
            <span>{safeHost(project.sourceUrl)}</span>
          </div>
        </div>
        <div className="dashboard" aria-label="Playback position">
          <span className="dashboard-time">{formatDuration(time, true)}</span>
          <span className="dashboard-total">/ {formatDuration(project.trimEnd - project.trimStart)}</span>
        </div>
        <div className="editor-header-right">
          <span className={`save-indicator ${saveState}`} aria-live="polite">
            {saveState === "saving" ? <span className="mini-spinner" /> : <Icon name={saveState === "error" ? "info" : "check"} size={13} />}
            {saveState === "saving" ? "Saving" : saveState === "error" ? "Save failed" : "Saved"}
          </span>
          <button className="primary-button header-export" onClick={() => void beginExport()} disabled={exportState.status === "running"}>
            <Icon name="share" size={15} /> Export
          </button>
        </div>
      </header>

      <div className="editor-main">
        <main className="workspace">
          <div className="canvas-area">
            <CanvasPreview
              project={project}
              recording={recording}
              time={time}
              playing={playing}
              targetMode={Boolean(targetZoomId)}
              onTimeChange={setCurrentTime}
              onPlayingChange={setPlaying}
              onTargetPick={pickTarget}
            />
          </div>
          <Transport time={time} start={project.trimStart} end={project.trimEnd} playing={playing} disabled={!recording} onTimeChange={(next) => { setPlaying(false); setCurrentTime(next); }} onPlayingChange={setPlaying} />
        </main>
        <Inspector
          project={project}
          selection={selection}
          targetMode={Boolean(targetZoomId)}
          setProject={setProject}
          onSelectionChange={(next) => { setSelection(next); if (!next || next.kind !== "zoom") setTargetZoomId(null); }}
          onTargetModeChange={(active) => setTargetZoomId(active && selection?.kind === "zoom" ? selection.id : null)}
          onExport={() => void beginExport()}
        />
      </div>

      <Timeline
        project={project}
        time={time}
        selection={selection}
        setProject={setProject}
        onTimeChange={(next) => { setPlaying(false); setCurrentTime(next); }}
        onSelectionChange={(next) => { setSelection(next); if (next?.kind !== "zoom") setTargetZoomId(null); }}
        onRequestTarget={requestTarget}
      />

      {exportState.status === "running" && (
        <div className="export-overlay" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div className="export-dialog">
            <div className="export-animation"><Icon name="film" size={24} /><span style={{ width: `${Math.round(exportState.progress * 100)}%` }} /></div>
            <span className="eyebrow">{exportState.phase === "transcode" ? "Offline MP4 conversion" : "Rendering on this device"}</span>
            <h2 id="export-title">{exportState.phase === "transcode" ? "Creating your MP4" : "Compositing your video"}</h2>
            <p>{exportState.phase === "transcode" ? "The bundled single-thread encoder is creating H.264 video and AAC audio. This can take longer than the initial render." : `Keep this editor open while every frame is composited${project.export.format === "mp4" ? ". MP4 conversion starts next" : " with its audio and effects"}.`}</p>
            <div className="export-progress"><span style={{ width: `${Math.round(exportState.progress * 100)}%` }} /></div>
            <div className="export-progress-label"><strong>{Math.round(exportState.progress * 100)}%</strong><span>{exportState.phase === "transcode" ? "Encoding locally · no upload" : `About ${Math.max(0, Math.ceil(((project.trimEnd - project.trimStart) / 1000) * (1 - exportState.progress)))}s remaining`}</span></div>
            <button className="button button-wide" onClick={() => exportState.controller.abort()}>Cancel export</button>
          </div>
        </div>
      )}

      {exportState.status === "error" && (
        <div className="toast error" role="alert"><Icon name="info" size={17} /><span>{exportState.message}</span><button onClick={() => setExportState({ status: "idle" })} aria-label="Dismiss">×</button></div>
      )}
      {exportState.status === "done" && <div className="toast success" role="status"><Icon name="check" size={17} /><span>{(project.export.format ?? "webm").toUpperCase()} export finished. Your download is ready.</span></div>}
    </div>
  );
}
