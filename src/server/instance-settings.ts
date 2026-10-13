import "server-only";
import { getDb, schema, type Db } from "@db/client";

const { instanceSettings } = schema;

export function guestsBlocked(db: Db = getDb()): boolean {
  return db.select({ blocked: instanceSettings.guestsBlocked }).from(instanceSettings).get()?.blocked ?? false;
}

export function setGuestsBlocked(blocked: boolean, db: Db = getDb()): void {
  db.insert(instanceSettings)
    .values({ id: 1, guestsBlocked: blocked })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { guestsBlocked: blocked } })
    .run();
}
