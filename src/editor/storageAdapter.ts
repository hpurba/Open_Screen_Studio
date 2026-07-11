import type { Project } from "../shared/types";
import {
  deleteProject,
  getProject,
  getRecordingBlob,
  listProjects,
  updateProject,
} from "../shared/storage";

// Keeping persistence behind this tiny boundary makes the UI independent of
// IndexedDB details and gives tests one straightforward module to mock.
export const projectStore = {
  list: listProjects,
  get: getProject,
  getRecording: getRecordingBlob,
  save: (project: Project) => updateProject(project),
  delete: deleteProject,
};
