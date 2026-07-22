import { useRef, useState, type CSSProperties } from "react";
import { T } from "../theme.js";

export interface MentionPerson {
  name: string;
  /** Already on this account? Off-account people can be quick-added on mention. */
  onAccount: boolean;
  /** Optional subtitle shown in the suggester (role/title). */
  sub?: string;
}

/**
 * A textarea with @mention autocomplete over the full AGP roster: type "@" and
 * a name suggester appears, filtered as you type; pick one and it inserts the
 * name (which notifies that person on post). People not yet on the account are
 * marked, and `onPick` fires so the parent can offer a quick "add them" window.
 * Keyboard: ↑/↓ move, Enter/Tab accept, Esc dismiss. Ctrl/Cmd+Enter → onSubmit.
 * Pure presentation — safe on guest surfaces.
 */
export function MentionTextarea({
  value,
  onChange,
  roster,
  placeholder,
  rows = 3,
  autoFocus,
  onSubmit,
  onPick,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  roster: readonly MentionPerson[];
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onSubmit?: () => void;
  /** Called when a name is accepted — parent can quick-add off-account people. */
  onPick?: (person: MentionPerson) => void;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [anchor, setAnchor] = useState<number | null>(null); // index of the '@'
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);

  const suggestions =
    anchor !== null
      ? roster
          .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
          // On-account people first, then the rest, alphabetical within each.
          .sort((a, b) => Number(b.onAccount) - Number(a.onAccount) || a.name.localeCompare(b.name))
          .slice(0, 7)
      : [];
  const showList = anchor !== null && suggestions.length > 0;

  const recompute = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /(^|\s)@([\p{L}\p{N}'.-]*)$/u.exec(before);
    if (m) {
      const q = m[2] ?? "";
      setAnchor(caret - q.length - 1);
      setQuery(q);
      setHi(0);
    } else {
      setAnchor(null);
      setQuery("");
    }
  };

  const accept = (person: MentionPerson) => {
    const el = ref.current;
    if (anchor === null || !el) return;
    const caret = el.selectionStart;
    const next = `${value.slice(0, anchor)}@${person.name} ${value.slice(caret)}`;
    onChange(next);
    setAnchor(null);
    setQuery("");
    onPick?.(person);
    const pos = anchor + person.name.length + 2; // past "@name "
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={ref}
        className="textarea"
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          recompute(e.target.value, e.target.selectionStart);
        }}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            recompute((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart);
          }
        }}
        onBlur={() => setTimeout(() => setAnchor(null), 120)}
        onKeyDown={(e) => {
          if (showList) {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % suggestions.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + suggestions.length) % suggestions.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(suggestions[hi] ?? suggestions[0]!); return; }
            if (e.key === "Escape") { e.preventDefault(); setAnchor(null); return; }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) onSubmit();
        }}
        style={{ width: "100%", ...style }}
      />
      {showList && (
        <div
          style={{
            position: "absolute", left: 6, top: "calc(100% - 2px)", zIndex: 30, minWidth: 210,
            background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8,
            boxShadow: "0 10px 26px rgba(11,33,63,0.18)", overflow: "hidden", padding: 4,
          }}
        >
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted, padding: "4px 8px 3px" }}>
            Mention someone
          </div>
          {suggestions.map((p, i) => (
            <button
              key={p.name}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); accept(p); }}
              onMouseEnter={() => setHi(i)}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", cursor: "pointer",
                fontSize: 12.5, fontWeight: 600, padding: "6px 9px", borderRadius: 6, border: "none",
                background: i === hi ? "#eef2fb" : "transparent", color: T.ink,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
                {p.sub && <span style={{ fontSize: 10, color: T.inkMuted, fontWeight: 400 }}> · {p.sub}</span>}
              </span>
              {!p.onAccount && (
                <span style={{ fontSize: 8.5, fontWeight: 800, color: "#8a6d1a", background: "#faf3dc", borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>+ ADD</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
