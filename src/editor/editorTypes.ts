export type EditorSelection =
  | { kind: "zoom"; id: string }
  | { kind: "hidden"; id: string }
  | null;
