// @vitest-environment node
import "fake-indexeddb/auto";

import { createProject } from "./project";
import {
  deleteProject,
  getProject,
  getRecording,
  listProjects,
  putProject,
  putRecordingChunk,
} from "./storage";

const project = (id: string, updatedAt: number) => ({
  ...createProject({
    id,
    title: `Project ${id}`,
    sourceUrl: "https://example.com",
    createdAt: updatedAt - 10,
    duration: 1000,
    sourceWidth: 1280,
    sourceHeight: 720,
    mimeType: "video/webm",
    events: [],
  }),
  updatedAt,
});

describe("project storage", () => {
  it("stores projects and returns the most recently edited first", async () => {
    await putProject(project("storage-old", 100));
    await putProject(project("storage-new", 200));

    expect((await getProject("storage-new"))?.title).toBe("Project storage-new");
    const summaries = await listProjects();
    expect(summaries.findIndex((item) => item.id === "storage-new")).toBeLessThan(
      summaries.findIndex((item) => item.id === "storage-old"),
    );
  });

  it("reassembles incrementally written chunks in numeric order", async () => {
    const id = "storage-chunks";
    await putProject(project(id, 300));
    await putRecordingChunk(id, 1, new Blob(["B"], { type: "video/webm" }));
    await putRecordingChunk(id, 0, new Blob(["A"], { type: "video/webm" }));

    const recording = await getRecording(id);
    expect(recording.type).toBe("video/webm");
    expect(await recording.text()).toBe("AB");
  });

  it("deletes project metadata and recording chunks together", async () => {
    const id = "storage-delete";
    await putProject(project(id, 400));
    await putRecordingChunk(id, 0, new Blob(["data"]));

    await deleteProject(id);

    expect(await getProject(id)).toBeUndefined();
    expect((await getRecording(id)).size).toBe(0);
  });
});
