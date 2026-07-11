import {
  cameraStateAt,
  cursorStateAt,
  type CameraState,
  type CursorState,
} from "../shared/effects";
import type { Project } from "../shared/types";

export type EditorEffectState = {
  camera: CameraState;
  cursor: CursorState;
};

/** The single integration point between editor rendering and the pure effects engine. */
export function effectsAt(project: Project, time: number): EditorEffectState {
  const cursor = cursorStateAt(
    project.events,
    project.hiddenCursorRanges,
    time,
    project.cursor,
  );
  return {
    camera: cameraStateAt(
      project.zooms,
      time,
      cursor.position,
      project.camera,
    ),
    cursor,
  };
}
