import { useEffect, useRef, useState } from "react";
import type { Project } from "../shared/types";
import { projectStore } from "./storageAdapter";

export type SaveState = "saved" | "saving" | "error";

export function useAutosave(project: Project | null, delay = 550) {
  const [state, setState] = useState<SaveState>("saved");
  const firstProject = useRef<string | null>(null);
  const revision = useRef(0);
  const latest = useRef<Project | null>(project);
  latest.current = project;

  useEffect(() => {
    if (!project) return;
    if (firstProject.current !== project.id) {
      firstProject.current = project.id;
      revision.current += 1;
      setState("saved");
      return;
    }

    const saveRevision = ++revision.current;
    setState("saving");
    const timeout = window.setTimeout(() => {
      const snapshot = latest.current;
      if (!snapshot) return;
      void projectStore
        .save({ ...snapshot, updatedAt: Date.now() })
        .then(() => {
          if (revision.current === saveRevision) setState("saved");
        })
        .catch(() => {
          if (revision.current === saveRevision) setState("error");
        });
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [delay, project]);

  useEffect(
    () => () => {
      const snapshot = latest.current;
      if (snapshot && firstProject.current === snapshot.id) {
        void projectStore.save({ ...snapshot, updatedAt: Date.now() });
      }
    },
    [],
  );

  return state;
}
