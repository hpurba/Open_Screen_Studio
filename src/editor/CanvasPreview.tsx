import { useEffect, useMemo, useRef, useState } from "react";
import type { Point, Project } from "../shared/types";
import {
  canvasPointToSource,
  drawCompositedFrame,
  type FrameComposition,
} from "./compositor";
import { clamp, outputSize } from "./utils";

type CanvasPreviewProps = {
  project: Project;
  recording: Blob | null;
  time: number;
  playing: boolean;
  targetMode: boolean;
  onTimeChange: (time: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onTargetPick: (target: Point) => void;
};

export function CanvasPreview({
  project,
  recording,
  time,
  playing,
  targetMode,
  onTimeChange,
  onPlayingChange,
  onTargetPick,
}: CanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<FrameComposition | null>(null);
  const projectRef = useRef(project);
  const handlersRef = useRef({ onTimeChange, onPlayingChange });
  const animationRef = useRef(0);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [availableSize, setAvailableSize] = useState({ width: 0, height: 0 });

  projectRef.current = project;
  handlersRef.current = { onTimeChange, onPlayingChange };

  const previewSize = useMemo(() => {
    const exported = outputSize(project);
    const width = Math.min(1280, exported.width);
    return {
      width,
      height: Math.max(2, Math.round((width / exported.width) * exported.height)),
    };
  }, [project]);
  const stageSize = useMemo(() => {
    if (!availableSize.width || !availableSize.height) return undefined;
    const scale = Math.min(
      availableSize.width / previewSize.width,
      availableSize.height / previewSize.height,
    );
    return {
      width: Math.max(1, Math.floor(previewSize.width * scale)),
      height: Math.max(1, Math.floor(previewSize.height * scale)),
    };
  }, [availableSize, previewSize]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const render = (at = time) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;
    frameRef.current = drawCompositedFrame(
      context,
      video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? video : null,
      projectRef.current,
      at,
    );
  };

  useEffect(() => {
    render(time);
    // render is deliberately recreated so every inspector edit redraws immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, time, previewSize.width, previewSize.height, videoReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !recording) {
      setVideoReady(false);
      return;
    }
    const url = URL.createObjectURL(recording);
    setVideoError(false);
    setVideoReady(false);
    video.src = url;
    video.load();
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
  }, [recording]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady) return;
    const desired = clamp(time, project.trimStart, project.trimEnd) / 1000;
    if (!playing && Math.abs(video.currentTime - desired) > 0.018) {
      video.currentTime = desired;
    } else if (playing && Math.abs(video.currentTime - desired) > 0.3) {
      video.currentTime = desired;
    }
  }, [playing, project.trimEnd, project.trimStart, time, videoReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady) return;
    cancelAnimationFrame(animationRef.current);
    if (!playing) {
      video.pause();
      render(time);
      return;
    }
    if (video.currentTime * 1000 >= project.trimEnd - 10) {
      video.currentTime = project.trimStart / 1000;
    }
    void video.play().catch(() => handlersRef.current.onPlayingChange(false));

    const tick = () => {
      const activeVideo = videoRef.current;
      if (!activeVideo) return;
      const nextTime = activeVideo.currentTime * 1000;
      if (nextTime >= projectRef.current.trimEnd || activeVideo.ended) {
        activeVideo.pause();
        handlersRef.current.onTimeChange(projectRef.current.trimEnd);
        handlersRef.current.onPlayingChange(false);
        render(projectRef.current.trimEnd);
        return;
      }
      render(nextTime);
      handlersRef.current.onTimeChange(nextTime);
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationRef.current);
    // Project updates are read through projectRef to avoid restarting playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, videoReady]);

  const chooseTarget = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!targetMode || !frameRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const point = {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
    const target = canvasPointToSource(point, frameRef.current, project);
    if (target) onTargetPick(target);
  };

  return (
    <div ref={wrapRef} className={`preview-wrap${targetMode ? " is-targeting" : ""}`}>
      <div className="preview-stage" style={{ aspectRatio: `${previewSize.width}/${previewSize.height}`, ...stageSize }}>
        <canvas
          ref={canvasRef}
          width={previewSize.width}
          height={previewSize.height}
          aria-label={targetMode ? "Click to set the zoom target" : "Video preview"}
          onPointerDown={chooseTarget}
        />
        {!recording && (
          <div className="preview-message">
            <span className="preview-message-icon">!</span>
            <strong>Recording unavailable</strong>
            <span>The edit data is safe, but the source video could not be loaded.</span>
          </div>
        )}
        {videoError && recording && (
          <div className="preview-message">
            <span className="preview-message-icon">!</span>
            <strong>Preview unavailable</strong>
            <span>Chrome could not decode this recording.</span>
          </div>
        )}
        {targetMode && (
          <div className="target-hint" role="status">
            <span className="target-crosshair" />
            Click a point in the recording to focus the zoom
          </div>
        )}
      </div>
      <video
        ref={videoRef}
        className="source-video"
        playsInline
        preload="auto"
        onLoadedData={() => {
          setVideoReady(true);
          const video = videoRef.current;
          if (video) video.currentTime = clamp(time, project.trimStart, project.trimEnd) / 1000;
          render(time);
        }}
        onSeeked={() => {
          const video = videoRef.current;
          if (video) render(video.currentTime * 1000);
        }}
        onError={() => setVideoError(true)}
      />
    </div>
  );
}
