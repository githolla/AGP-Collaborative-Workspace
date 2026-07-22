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
 * Find the @mention being typed at the caret. Returns the '@' index and the
 * query text after it, or null when the caret isn't inside a mention token.
 * Pure + exported so the behaviour is unit-tested (see MentionTextarea.test).
 */
export function mentionQueryAt(text: string, caret: number): { anchor: number; query: string } | null {
  const before = text.slice(0, Math.max(0, caret));
  // '@' at the start or after whitespace, then letters/digits/’.- up to caret.
  const m = /(?:^|\s)@([\p{L}\p{N}'.\-]*)$/u.exec(before);
  if (!m) return null;
  const query = m[1] ?? "";
  return { anchor: caret - query.length - 1, query };
}

/**
 * Rank roster people for a mention query. Matching is PREFIX-based (like Slack
 * / Teams): the query must start the full name or one of its words — so typing
 * letters visibly narrows the list. A plain substring ("a") is NOT a match, or
 * every name with an "a" would show and it'd look like nothing filtered. As a
 * last resort, if nothing prefix-matches, fall back to substring so a rare
 * mid-word search still finds someone. On-account people rank first.
 */
export function matchMentions(roster: readonly MentionPerson[], query: string, limit = 7): MentionPerson[] {
  const q = query.trim().toLowerCase();
  const score = (name: string): number => {
    if (!q) return 0;
    const parts = name.split(/\s+/);
    if (name.startsWith(q)) return 3; // whole name starts with query
    if (parts.some((w) => w.startsWith(q))) return 2; // a word starts with query
    return -1; // not a prefix match
  };
  const rank = (list: { p: MentionPerson; s: number }[]) =>
    list
      .sort((a, b) => Number(b.p.onAccount) - Number(a.p.onAccount) || b.s - a.s || a.p.name.localeCompare(b.p.name))
      .slice(0, limit)
      .map((x) => x.p);

  const prefix = roster.map((p) => ({ p, s: score(p.name.toLowerCase()) })).filter((x) => x.s >= 0);
  if (prefix.length > 0 || !q) return rank(prefix);

  // Fallback: no prefix hits — allow substring so a mid-word query still works.
  const sub = roster.filter((p) => p.name.toLowerCase().includes(q)).map((p) => ({ p, s: 0 }));
  return rank(sub);
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

  const suggestions = anchor !== null ? matchMentions(roster, query) : [];
  const showList = anchor !== null && suggestions.length > 0;

  const recompute = (text: string, caret: number) => {
    const hit = mentionQueryAt(text, caret);
    if (hit) {
      setAnchor(hit.anchor);
      setQuery(hit.query);
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
        onClick={(e) => recompute((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
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
