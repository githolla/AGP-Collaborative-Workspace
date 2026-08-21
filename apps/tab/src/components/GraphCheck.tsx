import { useState } from "react";
import { T } from "../theme.js";
import { Button, Card } from "./ui.js";
import { SectionTitle } from "./bits.js";
import { checkGraphProfile, graphConfigured } from "../auth/graphAuth.js";

/**
 * B1's own acceptance test ("the signed-in AGP user's own profile, fetched
 * from Graph, in the browser" — docs/teams-provisioning-plan.md), reachable
 * only at #admin, app-admin gated. Not a permanent feature: this exists so
 * verifying B1 — the FIRST thing that has to work before any Files/
 * Provisioning code is worth writing — is a one-click check rather than
 * something requiring new code once Graph consent (A1②) actually lands.
 */
export function GraphCheck({ loginHintEmail }: { loginHintEmail?: string }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkGraphProfile>> | null>(null);
  const [checking, setChecking] = useState(false);

  if (!graphConfigured()) {
    return (
      <Card>
        <SectionTitle>Microsoft Graph check</SectionTitle>
        <p style={{ color: T.inkMuted, fontSize: 14 }}>
          Not configured — VITE_GRAPH_CLIENT_ID / VITE_GRAPH_TENANT_ID are unset. See .env.example.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Microsoft Graph check</SectionTitle>
      <p style={{ color: T.inkMuted, fontSize: 14, marginBottom: 12 }}>
        Fetches your own Graph profile (GET /me) with a delegated token — proves the MSAL token flow and Entra's Graph
        app-level consent are both actually working, before anything else on the Files/Provisioning track is built.
      </p>
      <Button
        variant="secondary"
        disabled={checking}
        onClick={() => {
          setChecking(true);
          void checkGraphProfile(loginHintEmail).then((r) => {
            setResult(r);
            setChecking(false);
          });
        }}
      >
        {checking ? "Checking…" : "Check Graph profile"}
      </Button>
      {result && (
        <pre
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            background: result.ok ? "#e6f4ea" : "#fdecea",
            color: result.ok ? T.status.good : T.status.critical,
            fontSize: 12,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </Card>
  );
}
