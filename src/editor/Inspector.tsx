import { useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { Project } from "../shared/types";
import type { EditorSelection } from "./editorTypes";
import { Icon, type IconName } from "./icons";
import { clamp, formatDuration, outputSize } from "./utils";

type InspectorProps = {
  project: Project;
  selection: EditorSelection;
  targetMode: boolean;
  setProject: Dispatch<SetStateAction<Project>>;
  onSelectionChange: (selection: EditorSelection) => void;
  onTargetModeChange: (active: boolean) => void;
  onExport: () => void;
};

type Tab = "cursor" | "camera" | "frame" | "trim" | "export";

const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: "cursor", label: "Cursor", icon: "mouse" },
  { id: "camera", label: "Camera", icon: "zoom-in" },
  { id: "frame", label: "Frame", icon: "frame" },
  { id: "trim", label: "Trim", icon: "scissors" },
  { id: "export", label: "Export", icon: "share" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="inspector-section"><h3>{title}</h3>{children}</section>;
}

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  display?: string;
};

function SliderField({ label, value, min, max, step, onChange, display }: SliderProps) {
  const safe = clamp(value, min, max);
  const percent = max > min ? ((safe - min) / (max - min)) * 100 : 0;
  return (
    <label className="control-field slider-field">
      <span className="field-name">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safe}
        style={{ "--p": `${percent}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{display ?? value}</output>
    </label>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true"><span /></i>
    </label>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="segmented-field">
      <legend>{label}</legend>
      <div className="segmented-control">
        {options.map((option) => (
          <button
            type="button"
            className={value === option.value ? "active" : ""}
            key={option.value}
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function TimeInputs({
  start,
  end,
  duration,
  onChange,
}: {
  start: number;
  end: number;
  duration: number;
  onChange: (start: number, end: number) => void;
}) {
  return (
    <div className="time-inputs">
      <label>Start<input type="number" min={0} max={duration / 1000} step={0.1} value={(start / 1000).toFixed(1)} onChange={(event) => onChange(clamp(Number(event.target.value) * 1000, 0, end - 100), end)} /><span>s</span></label>
      <label>End<input type="number" min={0} max={duration / 1000} step={0.1} value={(end / 1000).toFixed(1)} onChange={(event) => onChange(start, clamp(Number(event.target.value) * 1000, start + 100, duration))} /><span>s</span></label>
    </div>
  );
}

export function Inspector({
  project,
  selection,
  targetMode,
  setProject,
  onSelectionChange,
  onTargetModeChange,
  onExport,
}: InspectorProps) {
  const [tab, setTab] = useState<Tab>("cursor");
  const update = <K extends keyof Project>(key: K, value: Project[K]) =>
    setProject((current) => ({ ...current, [key]: value }));
  const updateNested = <K extends "cursor" | "camera" | "frame" | "export">(
    key: K,
    value: Partial<Project[K]>,
  ) => setProject((current) => ({ ...current, [key]: { ...current[key], ...value } }));

  const selectedZoom = selection?.kind === "zoom"
    ? project.zooms.find((zoom) => zoom.id === selection.id)
    : undefined;
  const selectedHidden = selection?.kind === "hidden"
    ? project.hiddenCursorRanges.find((range) => range.id === selection.id)
    : undefined;
  const dimensions = outputSize(project);

  const updateZoom = (changes: Partial<NonNullable<typeof selectedZoom>>) => {
    if (!selectedZoom) return;
    setProject((current) => ({
      ...current,
      zooms: current.zooms.map((zoom) =>
        zoom.id === selectedZoom.id ? { ...zoom, ...changes } : zoom,
      ),
    }));
  };

  const removeSelection = () => {
    if (!selection) return;
    setProject((current) =>
      selection.kind === "zoom"
        ? { ...current, zooms: current.zooms.filter((zoom) => zoom.id !== selection.id) }
        : {
            ...current,
            hiddenCursorRanges: current.hiddenCursorRanges.filter(
              (range) => range.id !== selection.id,
            ),
          },
    );
    onSelectionChange(null);
    onTargetModeChange(false);
  };

  return (
    <aside className="inspector" aria-label="Editor settings">
      <div className="inspector-tabs" role="tablist" aria-label="Settings categories">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            role="tab"
            aria-selected={tab === item.id}
            aria-label={item.label}
            title={item.label}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={17} />
          </button>
        ))}
      </div>

      <div className="inspector-scroll">
        {(selectedZoom || selectedHidden) && (
          <Section title={selectedZoom ? "Selected zoom" : "Hidden cursor range"}>
            {selectedZoom && (
              <>
                <div className="selection-heading">
                  <span className={`type-pill ${selectedZoom.kind}`}>
                    <Icon name={selectedZoom.kind === "auto" ? "sparkles" : "zoom-in"} size={12} />
                    {selectedZoom.kind === "auto" ? "Auto zoom" : "Manual zoom"}
                  </span>
                  <span>{formatDuration(selectedZoom.end - selectedZoom.start, true)}</span>
                </div>
                <SliderField label="Zoom" min={1.05} max={3.5} step={0.05} value={selectedZoom.scale} display={`${selectedZoom.scale.toFixed(2)}×`} onChange={(scale) => updateZoom({ scale })} />
                <TimeInputs start={selectedZoom.start} end={selectedZoom.end} duration={project.duration} onChange={(start, end) => updateZoom({ start, end })} />
                <ToggleField label="Follow cursor" description="Let the camera drift beyond the target." checked={selectedZoom.follow} onChange={(follow) => updateZoom({ follow })} />
                <ToggleField label="Instant cut" description="Skip the camera easing for this zoom." checked={selectedZoom.instant ?? false} onChange={(instant) => updateZoom({ instant })} />
                <button className={`button button-wide${targetMode ? " active" : ""}`} onClick={() => onTargetModeChange(!targetMode)}>
                  <Icon name="mouse" size={15} />
                  {targetMode ? "Cancel target selection" : "Pick target on preview"}
                </button>
                <div className="target-coordinates">
                  Target {Math.round(selectedZoom.target.x * 100)}%, {Math.round(selectedZoom.target.y * 100)}%
                </div>
              </>
            )}
            {selectedHidden && (
              <>
                <p className="section-copy">The synthetic cursor fades out only inside this range. The source recording is unchanged.</p>
                <TimeInputs
                  start={selectedHidden.start}
                  end={selectedHidden.end}
                  duration={project.duration}
                  onChange={(start, end) =>
                    setProject((current) => ({
                      ...current,
                      hiddenCursorRanges: current.hiddenCursorRanges.map((range) =>
                        range.id === selectedHidden.id ? { ...range, start, end } : range,
                      ),
                    }))
                  }
                />
              </>
            )}
            <button className="danger-button" onClick={removeSelection}><Icon name="trash" size={15} /> Delete {selectedZoom ? "zoom" : "range"}</button>
          </Section>
        )}

        {tab === "cursor" && (
          <>
            <div className="inspector-heading"><span className="heading-icon"><Icon name="mouse" /></span><div><h2>Cursor</h2><p>Polish pointer movement and visibility.</p></div></div>
            <Section title="Appearance">
              <ToggleField label="Show cursor" checked={project.cursor.visible} onChange={(visible) => updateNested("cursor", { visible })} />
              <SliderField label="Size" min={0.5} max={2.5} step={0.05} value={project.cursor.size > 5 ? project.cursor.size / 100 : project.cursor.size} display={`${Math.round((project.cursor.size > 5 ? project.cursor.size : project.cursor.size * 100))}%`} onChange={(size) => updateNested("cursor", { size })} />
              <SliderField label="Smoothing" min={0} max={1} step={0.01} value={project.cursor.smoothing} display={`${Math.round(project.cursor.smoothing * 100)}%`} onChange={(smoothing) => updateNested("cursor", { smoothing })} />
              <ToggleField label="Click ripple" description="Subtle feedback around each recorded click." checked={project.cursor.clickRipple} onChange={(clickRipple) => updateNested("cursor", { clickRipple })} />
            </Section>
            <Section title="Visibility">
              <ToggleField label="Hide when idle" checked={project.cursor.hideWhenIdle} onChange={(hideWhenIdle) => updateNested("cursor", { hideWhenIdle })} />
              {project.cursor.hideWhenIdle && <SliderField label="Idle delay" min={500} max={5000} step={100} value={project.cursor.idleDelay} display={`${(project.cursor.idleDelay / 1000).toFixed(1)}s`} onChange={(idleDelay) => updateNested("cursor", { idleDelay })} />}
              <p className="section-copy compact">Use “Hide cursor” above the timeline for precise sections.</p>
            </Section>
          </>
        )}

        {tab === "camera" && (
          <>
            <div className="inspector-heading"><span className="heading-icon"><Icon name="zoom-in" /></span><div><h2>Camera</h2><p>Control automatic focus and motion.</p></div></div>
            <Section title="Zoom behavior">
              <ToggleField label="Automatic zooms" description="Use zoom ranges generated from clicks." checked={project.camera.autoZoom} onChange={(autoZoom) => updateNested("camera", { autoZoom })} />
              <SliderField label="Base zoom" min={1} max={1.5} step={0.01} value={project.camera.defaultScale} display={`${project.camera.defaultScale.toFixed(2)}×`} onChange={(defaultScale) => updateNested("camera", { defaultScale })} />
              <SliderField label="Transition" min={80} max={1200} step={20} value={project.camera.transitionMs} display={`${project.camera.transitionMs}ms`} onChange={(transitionMs) => updateNested("camera", { transitionMs })} />
            </Section>
            <Section title="Cursor follow">
              <SliderField label="Follow strength" min={0} max={1} step={0.01} value={project.camera.followStrength} display={`${Math.round(project.camera.followStrength * 100)}%`} onChange={(followStrength) => updateNested("camera", { followStrength })} />
              <SliderField label="Dead zone" min={0} max={0.35} step={0.01} value={project.camera.deadZone} display={`${Math.round(project.camera.deadZone * 100)}%`} onChange={(deadZone) => updateNested("camera", { deadZone })} />
              <p className="section-copy compact">Enable “Follow cursor” on an individual zoom to apply these settings.</p>
            </Section>
          </>
        )}

        {tab === "frame" && (
          <>
            <div className="inspector-heading"><span className="heading-icon"><Icon name="frame" /></span><div><h2>Frame</h2><p>Choose the canvas and recording treatment.</p></div></div>
            <Section title="Canvas">
              <Segmented label="Aspect ratio" value={project.frame.aspectRatio} options={[{ value: "source", label: "Source" }, { value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }, { value: "1:1", label: "1:1" }]} onChange={(aspectRatio) => updateNested("frame", { aspectRatio })} />
              <div className="background-grid" aria-label="Background">
                {["aurora", "midnight", "sunset", "ocean", "#18191f", "#f2f0eb"].map((background) => (
                  <button
                    key={background}
                    className={`background-swatch bg-${background.replace("#", "")}${project.frame.background === background ? " active" : ""}`}
                    style={background.startsWith("#") ? { background } : undefined}
                    onClick={() => updateNested("frame", { background })}
                    aria-label={`Use ${background} background`}
                    aria-pressed={project.frame.background === background}
                  ><span /></button>
                ))}
                <label className="color-picker" title="Custom solid color">
                  <input type="color" value={project.frame.background.startsWith("#") ? project.frame.background.slice(0, 7) : "#6c4df7"} onChange={(event) => updateNested("frame", { background: event.target.value })} />
                  <span>+</span>
                </label>
              </div>
            </Section>
            <Section title="Recording card">
              <SliderField label="Padding" min={0} max={180} step={2} value={project.frame.padding} display={`${project.frame.padding}px`} onChange={(padding) => updateNested("frame", { padding })} />
              <SliderField label="Corner radius" min={0} max={48} step={1} value={project.frame.cornerRadius} display={`${project.frame.cornerRadius}px`} onChange={(cornerRadius) => updateNested("frame", { cornerRadius })} />
              <SliderField label="Shadow" min={0} max={1} step={0.01} value={project.frame.shadow} display={`${Math.round(project.frame.shadow * 100)}%`} onChange={(shadow) => updateNested("frame", { shadow })} />
            </Section>
          </>
        )}

        {tab === "trim" && (
          <>
            <div className="inspector-heading"><span className="heading-icon"><Icon name="scissors" /></span><div><h2>Trim</h2><p>Set the exported in and out points.</p></div></div>
            <Section title="Recording range">
              <SliderField label="Start" min={0} max={Math.max(0, project.trimEnd - 100)} step={50} value={project.trimStart} display={formatDuration(project.trimStart, true)} onChange={(trimStart) => update("trimStart", trimStart)} />
              <SliderField label="End" min={Math.min(project.duration, project.trimStart + 100)} max={project.duration} step={50} value={project.trimEnd} display={formatDuration(project.trimEnd, true)} onChange={(trimEnd) => update("trimEnd", trimEnd)} />
              <TimeInputs start={project.trimStart} end={project.trimEnd} duration={project.duration} onChange={(trimStart, trimEnd) => setProject((current) => ({ ...current, trimStart, trimEnd }))} />
              <div className="range-summary"><span>Final duration</span><strong>{formatDuration(project.trimEnd - project.trimStart, true)}</strong></div>
            </Section>
          </>
        )}

        {tab === "export" && (
          <>
            <div className="inspector-heading"><span className="heading-icon"><Icon name="share" /></span><div><h2>Export</h2><p>Download a WebM or compatible MP4.</p></div></div>
            <Section title="Video">
              <Segmented label="Format" value={project.export.format ?? "webm"} options={[{ value: "webm", label: "WebM" }, { value: "mp4", label: "MP4" }]} onChange={(format) => updateNested("export", { format })} />
              <Segmented label="Long edge" value={project.export.width} options={[{ value: 1280, label: "1280" }, { value: 1920, label: "1920" }]} onChange={(width) => updateNested("export", { width })} />
              <Segmented label="Frame rate" value={project.export.fps} options={[{ value: 30, label: "30 fps" }, { value: 60, label: "60 fps" }]} onChange={(fps) => updateNested("export", { fps })} />
              <Segmented label="Quality" value={project.export.quality} options={[{ value: "standard", label: "Standard" }, { value: "high", label: "High" }]} onChange={(quality) => updateNested("export", { quality })} />
              <div className="export-summary"><span>{(project.export.format ?? "webm").toUpperCase()} · {dimensions.width} × {dimensions.height}</span><span>{formatDuration(project.trimEnd - project.trimStart)} · {project.export.format === "mp4" ? "Render + local H.264 conversion" : "Real-time render"}</span></div>
              {project.export.format === "mp4" && <p className="section-copy compact export-format-note">MP4 is broadly compatible, but its offline conversion takes longer and uses more memory. WebM is the fastest option.</p>}
              <button className="primary-button export-panel-button" onClick={onExport}><Icon name="share" size={15} /> Export {(project.export.format ?? "webm").toUpperCase()}</button>
            </Section>
            <div className="privacy-note"><Icon name="check" size={15} /><span>Rendered on this device. Nothing is uploaded.</span></div>
          </>
        )}
      </div>
    </aside>
  );
}
