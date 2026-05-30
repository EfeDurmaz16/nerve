import { ulid } from "ulid";

export const newId = (prefix: string): string => `${prefix}_${ulid()}`;
export const nowIso = (): string => new Date().toISOString();

export const idPrefixes = {
  task: "tsk",
  plan: "pln",
  pack: "pck",
  teaching: "tch",
  program: "prg",
  trace: "trc",
  cluster: "clu",
  eval: "evl",
  patch: "pat",
  receipt: "rcpt",
  replay: "rep",
} as const;
