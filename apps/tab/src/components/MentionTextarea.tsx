import { useRef, useState, type CSSProperties } from "react";
import { T } from "../theme.js";

/**
 * A textarea with @mention autocomplete: type "@" and a name suggester appears,
 * filtered as you type; pick one and it inserts the name (which notifies that
 * person on post). Keyboard: ↑/↓ to move, Enter/Tab to accept, Esc to dismiss.
 * Ctrl/Cmd+Enter fires onSubmit. Pure presentation — safe on guest surfaces.
 */
export function MentionTextarea({
  value,
  onChange,
  people,
  placeholder,
  rows = 3,
  autoFocus,
  onSubmit,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  people: readonly string[];
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onSubmit?: () => void;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [anchor, setAnchor] = useState<number | null>(null); // index of the '@'
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);

  const suggestions =
    anchor !== null
      ? people.filter((p) => p.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
      : [];
  const showList = anchor !== null && suggestions.length > 0;

  const recompute = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    // "@word" sitting at a word boundary, right up to the caret.
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

  const accept = (name: string) => {
    const el = ref.current;
    if (anchor === null || !el) return;
    const caret = el.selectionStart;
    const next = `${value.slice(0, anchor)}@${name} ${value.slice(caret)}`;
    onChange(next);
    setAnchor(null);
    setQuery("");
    const pos = anchor + name.length + 2; // past "@name "
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
          // Arrow keys / clicks move the caret without changing text.
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
            position: "absolute", left: 6, top: "calc(100% - 2px)", zIndex: 30, minWidth: 190,
            background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8,
            boxShadow: "0 10px 26px rgba(11,33,63,0.18)", overflow: "hidden", padding: 4,
          }}
        >
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted, padding: "4px 8px 3px" }}>
            Mention someone
          </div>
          {suggestions.map((p, i) => (
            <button
              key={p}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); accept(p); }}
              onMouseEnter={() => setHi(i)}
              style={{
                display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                fontSize: 12.5, fontWeight: 600, padding: "6px 9px", borderRadius: 6, border: "none",
                background: i === hi ? "#eef2fb" : "transparent", color: T.ink,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
