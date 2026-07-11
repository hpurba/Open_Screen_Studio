import type { Project, ProjectSummary } from "./types";

const DATABASE_NAME = "open-screen-studio";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const CHUNK_STORE = "recordingChunks";
const PROJECT_ID_INDEX = "projectId";

type RecordingChunk = {
  projectId: string;
  index: number;
  data: Blob;
};

let databasePromise: Promise<IDBDatabase> | undefined;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed.")),
      { once: true }
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () =>
        reject(
          transaction.error ?? new Error("IndexedDB transaction was aborted.")
        ),
      { once: true }
    );
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
      { once: true }
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser context."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = database.createObjectStore(CHUNK_STORE, {
          keyPath: ["projectId", "index"]
        });
        chunks.createIndex(PROJECT_ID_INDEX, "projectId", { unique: false });
      }
    });

    request.addEventListener(
      "success",
      () => {
        const database = request.result;
        database.addEventListener("versionchange", () => {
          database.close();
          databasePromise = undefined;
        });
        resolve(database);
      },
      { once: true }
    );
    request.addEventListener(
      "error",
      () => {
        databasePromise = undefined;
        reject(request.error ?? new Error("Unable to open the project database."));
      },
      { once: true }
    );
    request.addEventListener(
      "blocked",
      () => {
        databasePromise = undefined;
        reject(
          new Error(
            "The project database is blocked by another open extension page."
          )
        );
      },
      { once: true }
    );
  });

  return databasePromise;
}

export async function putProject(project: Project): Promise<Project> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, "readwrite");
  transaction.objectStore(PROJECT_STORE).put(project);
  await transactionComplete(transaction);
  return project;
}

export const saveProject = putProject;

export async function getProject(id: string): Promise<Project | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, "readonly");
  const request = transaction.objectStore(PROJECT_STORE).get(id) as IDBRequest<
    Project | undefined
  >;
  const project = await requestResult(request);
  await transactionComplete(transaction);
  return project;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, "readonly");
  const request = transaction
    .objectStore(PROJECT_STORE)
    .getAll() as IDBRequest<Project[]>;
  const projects = await requestResult(request);
  await transactionComplete(transaction);

  return projects
    .map(
      ({ id, title, sourceUrl, createdAt, updatedAt, duration }) => ({
        id,
        title,
        sourceUrl,
        createdAt,
        updatedAt,
        duration
      })
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function updateProject(project: Project): Promise<Project>;
export async function updateProject(
  id: string,
  update: Partial<Project> | ((project: Project) => Project)
): Promise<Project>;
export async function updateProject(
  projectOrId: Project | string,
  update?: Partial<Project> | ((project: Project) => Project)
): Promise<Project> {
  if (typeof projectOrId !== "string") return putProject(projectOrId);

  const current = await getProject(projectOrId);
  if (!current) throw new Error(`Project ${projectOrId} was not found.`);

  const next =
    typeof update === "function"
      ? update(current)
      : { ...current, ...update, id: current.id };

  return putProject({ ...next, updatedAt: Date.now() });
}

export async function putRecordingChunk(
  projectId: string,
  index: number,
  data: Blob
): Promise<void> {
  if (!projectId) throw new Error("A project id is required for recording data.");
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("A recording chunk index must be a non-negative integer.");
  }
  if (!(data instanceof Blob)) {
    throw new Error("Recording data must be stored as a Blob.");
  }

  const database = await openDatabase();
  const transaction = database.transaction(CHUNK_STORE, "readwrite");
  const chunk: RecordingChunk = { projectId, index, data };
  transaction.objectStore(CHUNK_STORE).put(chunk);
  await transactionComplete(transaction);
}

export const saveRecordingChunk = putRecordingChunk;

export async function getRecordingChunks(projectId: string): Promise<Blob[]> {
  const database = await openDatabase();
  const transaction = database.transaction(CHUNK_STORE, "readonly");
  const request = transaction
    .objectStore(CHUNK_STORE)
    .index(PROJECT_ID_INDEX)
    .getAll(IDBKeyRange.only(projectId)) as IDBRequest<RecordingChunk[]>;
  const chunks = await requestResult(request);
  await transactionComplete(transaction);

  return chunks
    .sort((left, right) => left.index - right.index)
    .map((chunk) => chunk.data);
}

export async function getRecordingBlob(
  projectId: string,
  mimeType?: string
): Promise<Blob> {
  const [chunks, project] = await Promise.all([
    getRecordingChunks(projectId),
    mimeType ? Promise.resolve(undefined) : getProject(projectId)
  ]);

  return new Blob(chunks, {
    type: mimeType ?? project?.mimeType ?? chunks[0]?.type ?? "video/webm"
  });
}

export const getRecording = getRecordingBlob;

export async function deleteRecordingChunks(projectId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(CHUNK_STORE, "readwrite");
  const index = transaction
    .objectStore(CHUNK_STORE)
    .index(PROJECT_ID_INDEX);
  const request = index.openKeyCursor(IDBKeyRange.only(projectId));

  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor) return;
    transaction.objectStore(CHUNK_STORE).delete(cursor.primaryKey);
    cursor.continue();
  });

  await transactionComplete(transaction);
}

export async function deleteProject(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [PROJECT_STORE, CHUNK_STORE],
    "readwrite"
  );
  transaction.objectStore(PROJECT_STORE).delete(id);

  const chunkStore = transaction.objectStore(CHUNK_STORE);
  const request = chunkStore
    .index(PROJECT_ID_INDEX)
    .openKeyCursor(IDBKeyRange.only(id));
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor) return;
    chunkStore.delete(cursor.primaryKey);
    cursor.continue();
  });

  await transactionComplete(transaction);
}

export async function estimateStorage(): Promise<StorageEstimate | undefined> {
  return navigator.storage?.estimate?.();
}
