import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { createProject } from "../shared/project";
import type { Project } from "../shared/types";
import type { EditorSelection } from "./editorTypes";
import { Timeline } from "./Timeline";

const initialProject = (): Project =>
  createProject({
    id: "timeline-project",
    title: "Timeline demo",
    sourceUrl: "https://example.com",
    duration: 10_000,
    sourceWidth: 1280,
    sourceHeight: 720,
    mimeType: "video/webm",
    events: [
      { type: "pointer", t: 4_000, x: 0.7, y: 0.3, cursor: "pointer" },
      { type: "click", t: 4_100, x: 0.7, y: 0.3, button: 0 },
    ],
  });

function Harness({ onTarget = () => undefined }: { onTarget?: (id: string) => void }) {
  const [project, setProject] = useState(initialProject);
  const [selection, setSelection] = useState<EditorSelection>(null);
  return (
    <>
      <Timeline
        project={project}
        time={4_000}
        selection={selection}
        setProject={setProject}
        onTimeChange={() => undefined}
        onSelectionChange={setSelection}
        onRequestTarget={onTarget}
      />
      <output data-testid="project-state">
        {JSON.stringify({ zooms: project.zooms, hidden: project.hiddenCursorRanges })}
      </output>
    </>
  );
}

describe("timeline editing", () => {
  it("adds a post-recording cursor-hidden range at the playhead", () => {
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "Hide cursor in a new range" }),
    );

    const state = JSON.parse(screen.getByTestId("project-state").textContent ?? "{}");
    expect(state.hidden).toHaveLength(1);
    expect(state.hidden[0]).toMatchObject({ start: 4_000, end: 6_000 });
    expect(screen.getByRole("button", { name: /Cursor hidden from/ })).toBeTruthy();
  });

  it("adds a manual zoom at the nearest cursor point and enters target mode", () => {
    const onTarget = vi.fn();
    render(<Harness onTarget={onTarget} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Add manual zoom at playhead" }),
    );

    const state = JSON.parse(screen.getByTestId("project-state").textContent ?? "{}");
    expect(state.zooms).toHaveLength(1);
    expect(state.zooms[0]).toMatchObject({
      kind: "manual",
      target: { x: 0.7, y: 0.3 },
      follow: false,
    });
    expect(onTarget).toHaveBeenCalledWith(state.zooms[0].id);
  });
});
