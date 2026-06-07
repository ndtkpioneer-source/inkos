import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { z } from "zod";
import { PlayEventSchema, type PlayEvent } from "../models/play.js";

const WORLDS_DIR = "worlds";

const PlayTranscriptTurnSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  timestamp: z.number().int().nonnegative(),
});

export type PlayTranscriptTurn = z.infer<typeof PlayTranscriptTurnSchema>;

const PlayWorldSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  premise: z.string().default(""),
  worldContract: z.string().default(""),
  visualContract: z.string().default(""),
  mode: z.enum(["open", "guided"]).default("open"),
  language: z.enum(["zh", "en"]).default("zh"),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type PlayWorld = z.infer<typeof PlayWorldSchema>;
export type PlayWorldInput = Omit<z.input<typeof PlayWorldSchema>, "createdAt" | "updatedAt"> & {
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export interface PlayRunSummary {
  readonly id: string;
  readonly updatedAt: string;
  readonly eventCount: number;
  readonly transcriptCount: number;
}

export class PlayStore {
  constructor(private readonly projectRoot: string) {}

  worldDir(worldId: string): string {
    return join(this.projectRoot, WORLDS_DIR, assertSafeSegment(worldId));
  }

  runDir(worldId: string, runId: string): string {
    return join(this.worldDir(worldId), "runs", assertSafeSegment(runId));
  }

  async ensureWorld(worldId: string): Promise<void> {
    await mkdir(this.worldDir(worldId), { recursive: true });
  }

  async createWorld(input: PlayWorldInput): Promise<PlayWorld> {
    const now = new Date().toISOString();
    const world = PlayWorldSchema.parse({
      ...input,
      id: assertSafeSegment(input.id),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    });
    await this.ensureWorld(world.id);
    await writeFile(
      join(this.worldDir(world.id), "world.json"),
      `${JSON.stringify(world, null, 2)}\n`,
      "utf-8",
    );
    return world;
  }

  async updateWorld(worldId: string, patch: Partial<Pick<PlayWorld, "premise" | "worldContract" | "visualContract" | "mode">>): Promise<PlayWorld> {
    const current = await this.loadWorld(worldId);
    if (!current) {
      throw new Error(`Play world not found: ${worldId}`);
    }
    const world = PlayWorldSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      title: current.title,
      language: current.language,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.ensureWorld(world.id);
    await writeFile(
      join(this.worldDir(world.id), "world.json"),
      `${JSON.stringify(world, null, 2)}\n`,
      "utf-8",
    );
    return world;
  }

  async loadWorld(worldId: string): Promise<PlayWorld | null> {
    try {
      const raw = await readFile(join(this.worldDir(worldId), "world.json"), "utf-8");
      const parsed = PlayWorldSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async listWorlds(): Promise<PlayWorld[]> {
    const worldsRoot = join(this.projectRoot, WORLDS_DIR);
    let entries: string[];
    try {
      entries = await readdir(worldsRoot);
    } catch {
      return [];
    }

    const worlds: PlayWorld[] = [];
    for (const entry of entries.sort()) {
      if (!isSafeSegment(entry)) continue;
      const entryStat = await stat(join(worldsRoot, entry)).catch(() => null);
      if (!entryStat?.isDirectory()) continue;
      const world = await this.loadWorld(entry);
      worlds.push(world ?? PlayWorldSchema.parse({
        id: entry,
        title: entry,
        premise: "",
        mode: "open",
        createdAt: entryStat.birthtime.toISOString(),
        updatedAt: entryStat.mtime.toISOString(),
      }));
    }
    return worlds.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async ensureRun(worldId: string, runId: string): Promise<void> {
    const dir = this.runDir(worldId, runId);
    await Promise.all([
      mkdir(dir, { recursive: true }),
      mkdir(join(dir, "state"), { recursive: true }),
      mkdir(join(dir, "projections"), { recursive: true }),
      mkdir(join(dir, "summaries"), { recursive: true }),
      mkdir(join(dir, "checkpoints"), { recursive: true }),
    ]);
  }

  async listRuns(worldId: string): Promise<PlayRunSummary[]> {
    const runsRoot = join(this.worldDir(worldId), "runs");
    let entries: string[];
    try {
      entries = await readdir(runsRoot);
    } catch {
      return [];
    }

    const runs: PlayRunSummary[] = [];
    for (const entry of entries.sort()) {
      if (!isSafeSegment(entry)) continue;
      const runDir = join(runsRoot, entry);
      const entryStat = await stat(runDir).catch(() => null);
      if (!entryStat?.isDirectory()) continue;
      const [events, transcript] = await Promise.all([
        this.readEvents(worldId, entry),
        this.readTranscript(worldId, entry),
      ]);
      runs.push({
        id: entry,
        updatedAt: entryStat.mtime.toISOString(),
        eventCount: events.length,
        transcriptCount: transcript.length,
      });
    }
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async appendEvent(worldId: string, runId: string, event: PlayEvent): Promise<void> {
    await this.ensureRun(worldId, runId);
    await this.appendJsonLine(
      this.eventsPath(worldId, runId),
      PlayEventSchema.parse(event),
    );
  }

  async appendRawEventLine(worldId: string, runId: string, line: string): Promise<void> {
    await this.ensureRun(worldId, runId);
    await appendFile(this.eventsPath(worldId, runId), `${line}\n`, "utf-8");
  }

  async readEvents(worldId: string, runId: string): Promise<PlayEvent[]> {
    return this.readJsonLines(this.eventsPath(worldId, runId), PlayEventSchema);
  }

  async appendTranscriptTurn(
    worldId: string,
    runId: string,
    turn: PlayTranscriptTurn,
  ): Promise<void> {
    await this.ensureRun(worldId, runId);
    await this.appendJsonLine(
      this.transcriptPath(worldId, runId),
      PlayTranscriptTurnSchema.parse(turn),
    );
  }

  async readTranscript(worldId: string, runId: string): Promise<PlayTranscriptTurn[]> {
    return this.readJsonLines(this.transcriptPath(worldId, runId), PlayTranscriptTurnSchema);
  }

  async saveCurrentState(
    worldId: string,
    runId: string,
    state: unknown,
  ): Promise<void> {
    await this.ensureRun(worldId, runId);
    await writeFile(
      join(this.runDir(worldId, runId), "state", "current.json"),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf-8",
    );
  }

  async loadCurrentState(worldId: string, runId: string): Promise<unknown> {
    const raw = await readFile(join(this.runDir(worldId, runId), "state", "current.json"), "utf-8");
    return JSON.parse(raw) as unknown;
  }

  async writeProjection(
    worldId: string,
    runId: string,
    relativePath: string,
    content: string,
  ): Promise<void> {
    await this.ensureRun(worldId, runId);
    const target = this.safeRunChildPath(worldId, runId, relativePath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf-8");
  }

  async readProjection(worldId: string, runId: string, relativePath: string): Promise<string> {
    return readFile(this.safeRunChildPath(worldId, runId, relativePath), "utf-8");
  }

  private eventsPath(worldId: string, runId: string): string {
    return join(this.runDir(worldId, runId), "events.jsonl");
  }

  private transcriptPath(worldId: string, runId: string): string {
    return join(this.runDir(worldId, runId), "transcript.jsonl");
  }

  private async appendJsonLine(path: string, value: unknown): Promise<void> {
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
  }

  private async readJsonLines<T>(
    path: string,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  ): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch {
      return [];
    }

    const rows: T[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = schema.safeParse(JSON.parse(line));
        if (parsed.success) rows.push(parsed.data);
      } catch {
        // Ignore malformed rows so one interrupted write does not break a run.
      }
    }
    return rows;
  }

  private safeRunChildPath(worldId: string, runId: string, relativePath: string): string {
    if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
      throw new Error(`Unsafe play path: ${relativePath}`);
    }
    const normalized = normalize(relativePath);
    if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
      throw new Error(`Unsafe play path: ${relativePath}`);
    }
    return join(this.runDir(worldId, runId), normalized);
  }
}

function assertSafeSegment(value: string): string {
  if (!isSafeSegment(value)) {
    throw new Error(`Unsafe play path segment: ${value}`);
  }
  return value;
}

function isSafeSegment(value: string): boolean {
  return Boolean(value) &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value !== "." &&
    value !== "..";
}
