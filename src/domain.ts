export const languages = [
  { id: "python3", label: "Python 3", extension: "py" },
  { id: "rust", label: "Rust", extension: "rs" },
  { id: "golang", label: "Go", extension: "go" },
  { id: "c", label: "C", extension: "c" },
  { id: "cpp", label: "C++", extension: "cpp" },
  { id: "java", label: "Java", extension: "java" },
] as const;
export type Language = typeof languages[number]["id"];
export type DraftKey = Readonly<{ account: string; problem: string; language: Language }>;
export type Draft = Readonly<{ code: string; cursor: number; revision: number }>;
export type OperationKind = "online-run" | "local-run" | "submission";
export type Snapshot = Readonly<DraftKey & {
  id: string; kind: OperationKind; code: string; testCase: string; revision: number;
}>;
export type Outcome =
  | Readonly<{ state: "pending"; snapshot: Snapshot }>
  | Readonly<{ state: "unknown"; snapshot: Snapshot; message: string }>
  | Readonly<{ state: "finished"; snapshot: Snapshot; message: string; submissionId?: string }>
  | Readonly<{ state: "failed"; snapshot: Snapshot; message: string }>;

// JSON 编码避免账号、题号中的分隔符造成键碰撞。凭据绝不能作为账号标识。
export function draftKey(key: DraftKey): string {
  if (!key.account || !key.problem || !languages.some(l => l.id === key.language))
    throw new Error("无效的草稿标识");
  return JSON.stringify([key.account, key.problem, key.language]);
}

export function createSnapshot(
  key: DraftKey, draft: Draft, kind: OperationKind, testCase: string, id: string,
): Snapshot {
  draftKey(key);
  if (!id) throw new Error("操作 ID 不能为空");
  // 所有字段都是标量；复制并冻结，后续编辑不能改变评测对应的代码。
  return Object.freeze({
    account: key.account, problem: key.problem, language: key.language,
    id, kind, code: draft.code, testCase, revision: draft.revision,
  });
}

export function belongsToCurrent(outcome: Outcome, key: DraftKey, draft: Draft): boolean {
  const s = outcome.snapshot;
  return draftKey(s) === draftKey(key) && s.code === draft.code && s.revision === draft.revision;
}

export class DraftBook {
  #drafts = new Map<string, Draft>();
  read(key: DraftKey, template = ""): Draft {
    return this.#drafts.get(draftKey(key)) ?? Object.freeze({ code: template, cursor: 0, revision: 0 });
  }
  edit(key: DraftKey, code: string, cursor: number): Draft {
    const previous = this.read(key);
    const next = Object.freeze({
      code, cursor: Math.max(0, Math.min(code.length, Math.trunc(Number.isFinite(cursor) ? cursor : 0))),
      revision: previous.revision + 1,
    });
    this.#drafts.set(draftKey(key), next);
    return next;
  }
}

// 此门闩只防客户端重复发送，不声称远端 exactly-once。
// 结果未知时保留锁；只有用户核查后的明确决定才能解除。
export class SubmissionGate {
  #active = new Map<string, string>();
  #scope(key: DraftKey): string {
    draftKey(key);
    return JSON.stringify([key.account, key.problem]);
  }
  begin(snapshot: Snapshot): void {
    if (snapshot.kind !== "submission") throw new Error("只接受正式提交");
    const scope = this.#scope(snapshot);
    if (this.#active.has(scope)) throw new Error("这道题仍有待确认的提交");
    this.#active.set(scope, snapshot.id);
  }
  settle(snapshot: Snapshot): void {
    const scope = this.#scope(snapshot);
    if (this.#active.get(scope) === snapshot.id) this.#active.delete(scope);
  }
  isPending(key: DraftKey): boolean { return this.#active.has(this.#scope(key)); }
}

export type SaveState =
  | { state: "saving" }
  | { state: "saved"; revision: number }
  | { state: "failed"; message: string };

// 外部编辑与内部编辑并发时，把两份正文交给 UI；此处绝不替用户覆盖。
export function reconcileText(base: string, local: string, external: string):
  | { state: "clean"; text: string }
  | { state: "conflict"; local: string; external: string } {
  if (local === external) return { state: "clean", text: local };
  if (local === base) return { state: "clean", text: external };
  if (external === base) return { state: "clean", text: local };
  return { state: "conflict", local, external };
}
