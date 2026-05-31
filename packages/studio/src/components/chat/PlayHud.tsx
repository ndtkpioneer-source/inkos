import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, X, ChevronDown } from "lucide-react";
import { fetchJson } from "../../hooks/use-api";

// The HUD is genre-neutral: it renders whatever the world graph contains,
// grouped into "what I face" (world/here-now) and "what I hold" (backpack).
// It never hardcodes a mystery-only layout — sections derive from entity
// types, edge types, and state-slot kinds, and empty sections are hidden.

interface PlayEntity {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly summary?: string;
  readonly status?: string;
}
interface PlayEdge {
  readonly id: string;
  readonly fromId: string;
  readonly type: string;
  readonly toId: string;
  readonly validUntilEventId?: string | null;
  readonly strength?: number | null;
}
interface PlayStateSlot {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly value: unknown;
  readonly updatedEventId?: string;
}
interface PlayEvent {
  readonly id: string;
  readonly turn: number;
  readonly outcomeSummary?: string;
}
interface PlayGraph {
  readonly entities: ReadonlyArray<PlayEntity>;
  readonly edges: ReadonlyArray<PlayEdge>;
  readonly stateSlots: ReadonlyArray<PlayStateSlot>;
  readonly events: ReadonlyArray<PlayEvent>;
}
interface PlayRunResponse {
  readonly title?: string;
  readonly currentState?: { turn?: number; mode?: string; premise?: string } | null;
  readonly graph?: PlayGraph;
}

const HOLDING_TYPES = new Set(["item", "evidence", "clue", "claim", "proof_chain"]);
const HOLDING_GLYPH: Record<string, string> = {
  item: "🎒", evidence: "📄", clue: "🔍", claim: "💡", proof_chain: "🔗",
};
const SLOT_GLYPH: Record<string, string> = {
  timer: "⏳", pressure: "🔥", resource: "🪙", relation: "❤", clue: "🔍", evidence: "📄", flag: "🚩",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

interface HudDetail {
  readonly label?: string;
  readonly text: string;
}
interface HudRow {
  readonly id: string;
  readonly glyph: string;
  readonly label: string;
  readonly value?: string;
  readonly note?: string | null;
  // Extra info shown when the row is expanded (summary, relationships, why a
  // meter changed). A row is expandable only when this is non-empty.
  readonly details: ReadonlyArray<HudDetail>;
}
interface HudView {
  readonly turn: number | null;
  readonly mode: string | null;
  readonly premise: string;
  readonly facing: ReadonlyArray<HudRow>;
  readonly holdings: ReadonlyArray<HudRow>;
  readonly meters: ReadonlyArray<HudRow>;
}

function buildView(run: PlayRunResponse | null): HudView | null {
  if (!run?.graph) return null;
  const { entities, edges, stateSlots, events } = run.graph;
  const labelOf = new Map(entities.map((e) => [e.id, e.label]));
  const outcomeOf = new Map(events.map((e) => [e.id, e.outcomeSummary ?? ""]));
  const currentEdges = edges.filter((e) => e.validUntilEventId == null);

  const summaryDetail = (e: PlayEntity): HudDetail[] =>
    e.summary && e.summary.trim() ? [{ text: e.summary.trim() }] : [];
  // All current relationships involving an entity, ids resolved to labels.
  const relationDetails = (id: string): HudDetail[] =>
    currentEdges
      .filter((e) => e.fromId === id || e.toId === id)
      .map((e) => {
        const other = e.fromId === id ? labelOf.get(e.toId) : labelOf.get(e.fromId);
        const strength = typeof e.strength === "number" ? ` ${e.strength}` : "";
        return { label: "关系", text: `${e.type}${strength}${other ? ` · ${other}` : ""}` };
      });

  const locations: HudRow[] = entities
    .filter((e) => e.type === "location")
    .map((e) => ({ id: e.id, glyph: "📍", label: e.label, note: e.status ?? null, details: summaryDetail(e) }));
  const actors: HudRow[] = entities
    .filter((e) => e.type === "actor")
    .map((e) => ({
      id: e.id,
      glyph: "👤",
      label: e.label,
      note: e.status ?? null,
      details: [...summaryDetail(e), ...relationDetails(e.id)],
    }));
  const holdings: HudRow[] = entities
    .filter((e) => HOLDING_TYPES.has(e.type))
    .map((e) => ({
      id: e.id,
      glyph: HOLDING_GLYPH[e.type] ?? "•",
      label: e.label,
      note: e.status ?? null,
      details: summaryDetail(e),
    }));
  const meters: HudRow[] = stateSlots.map((slot) => {
    const cause = slot.updatedEventId ? outcomeOf.get(slot.updatedEventId) || "" : "";
    return {
      id: slot.id,
      glyph: SLOT_GLYPH[slot.kind] ?? "•",
      label: slot.label,
      value: formatValue(slot.value),
      note: null,
      details: cause ? [{ label: "因为", text: cause }] : [],
    };
  });

  const turnFromEvents = events.reduce((max, e) => Math.max(max, e.turn), 0);
  return {
    turn: run.currentState?.turn ?? (events.length > 0 ? turnFromEvents : null),
    mode: run.currentState?.mode ?? null,
    premise: run.currentState?.premise ?? "",
    facing: [...locations, ...actors],
    holdings,
    meters,
  };
}

export function PlayHud(props: {
  readonly sessionId: string;
  readonly isStreaming: boolean;
  readonly isZh: boolean;
  readonly sessionTitle?: string | null;
}) {
  const { sessionId, isStreaming, isZh } = props;
  const [open, setOpen] = useState(true);
  const [run, setRun] = useState<PlayRunResponse | null>(null);
  const [hasUnseen, setHasUnseen] = useState(false);
  const openRef = useRef(open);
  const prevStreaming = useRef(isStreaming);
  openRef.current = open;

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<PlayRunResponse>(`/play/runs/${encodeURIComponent(sessionId)}/main`);
      setRun(data);
      if (!openRef.current) setHasUnseen(true);
    } catch {
      // A play session may not have a persisted world yet (no first action).
      // Leaving run null renders the empty state; do not surface an error.
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  // Refetch when a turn finishes (streaming true -> false).
  useEffect(() => {
    if (prevStreaming.current && !isStreaming) void load();
    prevStreaming.current = isStreaming;
  }, [isStreaming, load]);

  const view = useMemo(() => buildView(run), [run]);

  const title = props.sessionTitle?.trim() || run?.title?.trim() || (isZh ? "互动世界" : "Play World");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setHasUnseen(false); }}
        className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/90 px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur hover:text-primary"
        title={isZh ? "打开世界面板" : "Open world panel"}
      >
        <Gamepad2 size={14} />
        {hasUnseen && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </button>
    );
  }

  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-[330px] flex-col border-l border-border/40 bg-card/95 backdrop-blur shadow-xl">
      <header className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Gamepad2 size={13} />
            <span className="truncate">{title}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {view?.turn != null ? `${isZh ? "第" : "Turn "}${view.turn}${isZh ? " 幕" : ""}` : isZh ? "尚未开始" : "Not started"}
            {view?.mode ? ` · ${view.mode === "guided" ? (isZh ? "互动模式" : "Guided") : (isZh ? "开放模式" : "Open")}` : ""}
          </div>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" title={isZh ? "收起" : "Collapse"}>
          <X size={15} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
        {!view ? (
          <p className="text-xs leading-6 text-muted-foreground">
            {isZh
              ? "这个世界还没有状态。在左侧输入第一个动作，系统会生成开场并把人物、线索、状态显示在这里。"
              : "No world state yet. Take your first action on the left and characters, clues, and state will appear here."}
          </p>
        ) : (
          <>
            <Zone
              title={isZh ? "我面对的" : "Around me"}
              empty={view.facing.length === 0}
              emptyText={isZh ? "周围还没有出现地点或人物" : "No places or people around yet"}
            >
              {view.facing.map((row) => (
                <Row key={row.id} row={row} isZh={isZh} />
              ))}
            </Zone>

            <Zone
              title={isZh ? "我握有的" : "What I hold"}
              empty={view.holdings.length === 0}
              emptyText={isZh ? "还没有获得物品、证据或线索" : "No items, evidence, or clues yet"}
            >
              {view.holdings.map((row) => (
                <Row key={row.id} row={row} isZh={isZh} />
              ))}
            </Zone>

            <Zone
              title={isZh ? "状态" : "State"}
              empty={view.meters.length === 0}
              emptyText={isZh ? "还没有出现数值（压力、资源、关系、倒计时等）" : "No meters yet (pressure, resources, relations, timers…)"}
            >
              {view.meters.map((row) => (
                <Row key={row.id} row={row} isZh={isZh} />
              ))}
            </Zone>

            {view.premise && (
              <div className="rounded-lg border border-border/30 bg-secondary/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                {view.premise}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Zone(props: {
  readonly title: string;
  readonly empty: boolean;
  readonly emptyText: string;
  readonly children: React.ReactNode;
}) {
  // Always render the category so the player sees the structure ("what kinds of
  // things can show up here"); content fills in as the story produces it.
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{props.title}</h3>
      {props.empty ? (
        <p className="text-[11px] italic leading-5 text-muted-foreground/40">{props.emptyText}</p>
      ) : (
        <div className="space-y-1.5">{props.children}</div>
      )}
    </section>
  );
}

function Row({ row, isZh }: { readonly row: HudRow; readonly isZh: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = row.details.length > 0;
  return (
    <div className="rounded-lg border border-border/30 bg-secondary/30">
      <div
        role={expandable ? "button" : undefined}
        title={expandable ? (open ? (isZh ? "收起" : "Collapse") : (isZh ? "展开详情" : "Show details")) : undefined}
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
        className={`px-2.5 py-1.5 ${expandable ? "cursor-pointer" : ""}`}
      >
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-xs">{row.glyph}</span>
          <span className="text-[13px] font-medium text-foreground">{row.label}</span>
          {row.value ? <span className="ml-auto text-[13px] font-semibold text-primary">{row.value}</span> : null}
          {expandable ? (
            <ChevronDown
              size={12}
              className={`${row.value ? "ml-1.5" : "ml-auto"} shrink-0 text-muted-foreground/50 transition-transform ${open ? "rotate-180" : ""}`}
            />
          ) : null}
        </div>
        {row.note ? <div className="mt-0.5 pl-5 text-[11px] leading-4 text-muted-foreground">{row.note}</div> : null}
      </div>
      {open && (
        <div className="space-y-1 px-2.5 pb-2 pl-7">
          {row.details.map((detail, i) => (
            <p key={i} className="text-[11px] leading-5 text-muted-foreground">
              {detail.label ? <span className="text-muted-foreground/50">{detail.label} </span> : null}
              {detail.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
