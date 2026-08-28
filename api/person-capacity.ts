/**
 * POST /api/person-capacity — set one person's weekly capacity (hours), the
 * supply side of the Team Load view. App-admin only, enforced inside
 * collab.set_person_capacity (SECURITY DEFINER). Body: { name, weeklyHours }.
 */

import { requireUser } from "./_lib/requireUser.js";
import { withUserContext } from "./_lib/db.js";
import { toApiError } from "./_lib/apiError.js";

export default async function handler(
  req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> },
  res: { status: (code: number) => { json: (body: unknown) => void }; setHeader: (k: string, v: string) => void },
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: { code: "validation_failed", message: "POST only" } });
    return;
  }

  const auth = await requireUser(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const b = req.body as { name?: unknown; weeklyHours?: unknown };
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  const weeklyHours = typeof b?.weeklyHours === "number" ? b.weeklyHours : Number(b?.weeklyHours);
  if (!name || !Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 168) {
    res.status(400).json({ error: { code: "validation_failed", message: "name and weeklyHours (0–168) are required" } });
    return;
  }

  try {
    const [updated] = await withUserContext(auth.userId!, async (tx) => {
      return await tx<{ person_key: string; display_name: string; weekly_hours: string }[]>`
        select person_key, display_name, weekly_hours from collab.set_person_capacity(${name}, ${weeklyHours})
      `;
    });
    if (!updated) throw new Error("set_person_capacity returned no row");
    res.status(200).json({ data: { name: updated.display_name, weeklyHours: Number(updated.weekly_hours) } });
  } catch (err) {
    const { status, body } = toApiError(err);
    res.status(status).json(body);
  }
}
