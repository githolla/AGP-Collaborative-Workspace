import { useMemo, useState } from "react";
import { T } from "../theme.js";
import { intakeChoices, type DraftOverrides } from "../workspace/copilot.js";
import { extractTitle } from "../workspace/planner.js";
import type { AgpFunction } from "../workspace/agpKnowledge.js";

/**
 * The one intake for starting anything (Home + Sandbox). One box for the idea
 * in plain words, plus tap-to-fill buttons — department, service line,
 * vertical, client — so the user clicks what they already know instead of
 * writing it all into the pitch. Picks are optional and win over the
 * Copilot's own inference when the draft is built.
 */
export function IntakePanel({
  onCreate,
  placeholder,
  rows = 2,
}: {
  onCreate: (title: string, pitch: string, aiMode: "copilot" | "observer", overrides: DraftOverrides) => void;
  placeholder?: string;
  rows?: number;
}) {
  const choices = useMemo(intakeChoices, []);
  const [text, setText] = useState("");
  const [departmentFn, setDepartmentFn] = useState<AgpFunction | undefined>(undefined);
  const [serviceLine, setServiceLine] = useState<string | undefined>(undefined);
  const [vertical, setVertical] = useState<string | undefined>(undefined);
  const [clientName, setClientName] = useState<string | undefined>(undefined);

  const picks = [
    departmentFn && choices.departments.find((d) => d.fn === departmentFn)?.label,
    serviceLine,
    vertical,
    clientName,
  ].filter(Boolean) as string[];
  // Picks alone can carry an idea — three words of text OR any pick is enough.
  const ready = text.trim().split(/\s+/).filter(Boolean).length >= 3 || (text.trim().length > 0 && picks.length > 0);

  const start = (aiMode: "copilot" | "observer") => {
    if (!ready) return;
    const overrides: DraftOverrides = {
      ...(departmentFn ? { departmentFn } : {}),
      ...(serviceLine ? { serviceLine } : {}),
      ...(vertical ? { vertical } : {}),
      ...(clientName ? { clientName } : {}),
    };
    onCreate(extractTitle(text.trim()), text.trim(), aiMode, overrides);
    setText("");
    setDepartmentFn(undefined);
    setServiceLine(undefined);
    setVertical(undefined);
    setClientName(undefined);
  };

  const chipRow = <V extends string>(
    label: string,
    options: { value: V; text: string }[],
    selected: V | undefined,
    onPick: (v: V | undefined) => void,
  ) => (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: T.inkMuted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          width: 86,
          flexShrink: 0,
          paddingTop: 6,
        }}
      >
        {label}
      </span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`chip-pick${selected === o.value ? " active" : ""}`}
            onClick={() => onPick(selected === o.value ? undefined : o.value)}
          >
            {selected === o.value ? "✓ " : ""}
            {o.text}
          </button>
        ))}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start("copilot");
        }}
        placeholder={placeholder ?? "One sentence is enough — “What if we drafted grant compliance reports automatically?”"}
        rows={rows}
        style={{ fontSize: 13.5, padding: "11px 14px", borderRadius: 10 }}
      />

      {/* Tap what you already know — every pick is optional and removable. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {chipRow(
          "Department",
          choices.departments.map((d) => ({ value: d.fn, text: d.label })),
          departmentFn,
          setDepartmentFn,
        )}
        {chipRow(
          "Service line",
          choices.serviceLines.map((s) => ({ value: s, text: s })),
          serviceLine,
          setServiceLine,
        )}
        {chipRow(
          "Vertical",
          choices.verticals.map((v) => ({ value: v, text: v })),
          vertical,
          setVertical,
        )}
        {chipRow(
          "Client",
          choices.clients.map((c) => ({ value: c, text: c })),
          clientName,
          setClientName,
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={!ready}
          onClick={() => start("copilot")}
          title="The Copilot names it, sizes it, plans it, and picks the team — your taps above steer it"
        >
          Build it for me →
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-lg"
          disabled={!ready}
          onClick={() => start("observer")}
          title="No drafting — you and your team shape it; the Copilot observes quietly and joins only when invited"
        >
          Start blank — just us
        </button>
        <span style={{ fontSize: 11, color: T.inkMuted }}>
          {picks.length > 0
            ? `Crafting with your picks: ${picks.join(" · ")}`
            : "Tap a department, service line, vertical, or client above — the Copilot crafts the plan around your picks."}
        </span>
      </div>
    </div>
  );
}
