import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";

const {createCharacterImageService} = await import("./characterImageService.js");

type Row = {
  id: string;
  characterId: string;
  userId: string;
  storagePath: string;
  thumbPath: string | null;
  mimeType: string;
  source: string;
  createdAt: Date;
  deletedAt: Date | null;
};

function makeStore(initial: Row[] = []) {
  const rows = [...initial];
  return {
    rows,
    repo: {
      async listByCharacter(characterId: string): Promise<Row[]> {
        return rows
          .filter((r) => r.characterId === characterId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      async listLiveByCharacter(characterId: string): Promise<Row[]> {
        return rows
          .filter((r) => r.characterId === characterId && !r.deletedAt)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      },
      async upsert(row: Row): Promise<void> {
        const idx = rows.findIndex((r) => r.id === row.id);
        if (idx >= 0) rows[idx] = row; else rows.push(row);
      },
      async tombstone(id: string): Promise<void> {
        const row = rows.find((r) => r.id === id);
        if (row) row.deletedAt = new Date();
      },
      async getActiveImageId(): Promise<string | null> {
        return activeImageId;
      },
      async setActiveImageId(_characterId: string, id: string | null): Promise<void> {
        activeImageId = id;
      },
      async deleteByCharacter(characterId: string, _userId: string): Promise<void> {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].characterId === characterId) rows.splice(i, 1);
        }
      },
      async deleteTombstonesOlderThan(cutoff: Date): Promise<number> {
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const deletedAt = rows[i].deletedAt;
          if (deletedAt && deletedAt.getTime() < cutoff.getTime()) {
            rows.splice(i, 1);
            count += 1;
          }
        }
        return count;
      },
    },
  };
}

let activeImageId: string | null = null;
const deletedObjects: string[] = [];
const storage = {
  deleteObjects: async (paths: string[]) => { deletedObjects.push(...paths); },
  deletePrefix: async () => {},
  createSignedUrl: async (p: string) => `https://signed/${p}`,
};

function row(id: string, createdAt: number, overrides: Partial<Row> = {}): Row {
  return {
    id,
    characterId: "c1",
    userId: "u1",
    storagePath: `users/u1/characters/c1/${id}.webp`,
    thumbPath: `users/u1/characters/c1/${id}_thumb.webp`,
    mimeType: "image/webp",
    source: "generated",
    createdAt: new Date(createdAt),
    deletedAt: null,
    ...overrides,
  };
}

test("inserting below the cap evicts nothing", async () => {
  activeImageId = null;
  deletedObjects.length = 0;
  const {repo} = makeStore([row("a", 1)]);
  const service = createCharacterImageService(repo as never, storage as never);
  const result = await service.syncImages("c1", "u1", [row("b", 2)]);
  assert.deepEqual(result.evictedImageIds, []);
});

test("inserting over the cap evicts the oldest and returns their ids", async () => {
  activeImageId = null;
  deletedObjects.length = 0;
  const existing = Array.from({length: 100}, (_, i) => row(`old-${i}`, i + 1));
  const {repo} = makeStore(existing);
  const service = createCharacterImageService(repo as never, storage as never);
  const result = await service.syncImages("c1", "u1", [row("new", 1000)]);
  assert.deepEqual(result.evictedImageIds, ["old-0"]);
  assert.deepEqual(deletedObjects, [
    "users/u1/characters/c1/old-0.webp",
    "users/u1/characters/c1/old-0_thumb.webp",
  ]);
});

test("the active image is never evicted", async () => {
  activeImageId = "old-0";
  deletedObjects.length = 0;
  const existing = Array.from({length: 100}, (_, i) => row(`old-${i}`, i + 1));
  const {repo} = makeStore(existing);
  const service = createCharacterImageService(repo as never, storage as never);
  const result = await service.syncImages("c1", "u1", [row("new", 1000)]);
  assert.deepEqual(result.evictedImageIds, ["old-1"]);
});

test("eviction tombstones the row rather than deleting it", async () => {
  activeImageId = null;
  const existing = Array.from({length: 100}, (_, i) => row(`old-${i}`, i + 1));
  const store = makeStore(existing);
  const service = createCharacterImageService(store.repo as never, storage as never);
  await service.syncImages("c1", "u1", [row("new", 1000)]);
  const evicted = store.rows.find((r) => r.id === "old-0");
  assert.ok(evicted);
  assert.ok(evicted.deletedAt instanceof Date);
});

test("deleting an image tombstones it and removes its objects", async () => {
  activeImageId = null;
  deletedObjects.length = 0;
  const store = makeStore([row("a", 1)]);
  const service = createCharacterImageService(store.repo as never, storage as never);
  await service.deleteImages("c1", "u1", ["a"]);
  assert.deepEqual(deletedObjects, [
    "users/u1/characters/c1/a.webp",
    "users/u1/characters/c1/a_thumb.webp",
  ]);
  assert.ok(store.rows[0].deletedAt);
});

test("listing returns tombstones so clients can reconcile deletions", async () => {
  const store = makeStore([row("a", 1), row("b", 2, {deletedAt: new Date(3)})]);
  const service = createCharacterImageService(store.repo as never, storage as never);
  const images = await service.listImages("c1");
  assert.deepEqual(images.map((i) => i.id).sort(), ["a", "b"]);
});

test("purgeCharacter scopes the row delete by userId, not just characterId", async () => {
  let receivedArgs: unknown[] = [];
  const repo = {
    deleteByCharacter: async (characterId: string, userId: string) => {
      receivedArgs = [characterId, userId];
    },
  };
  const service = createCharacterImageService(repo as never, storage as never);
  await service.purgeCharacter("firebase-uid-1", "db-user-1", "c1");
  assert.deepEqual(receivedArgs, ["c1", "db-user-1"]);
});

test("sweepExpiredTombstones drops rows tombstoned past the retention window", async () => {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const store = makeStore([
    row("old-tombstone", 1, {deletedAt: new Date(now - 31 * DAY_MS)}),
    row("recent-tombstone", 2, {deletedAt: new Date(now - 1 * DAY_MS)}),
    row("live", 3, {deletedAt: null}),
  ]);
  const service = createCharacterImageService(store.repo as never, storage as never);
  const deletedCount = await service.sweepExpiredTombstones(30);
  assert.equal(deletedCount, 1);
  assert.deepEqual(store.rows.map((r) => r.id).sort(), ["live", "recent-tombstone"]);
});

test("sweepExpiredTombstones never touches Storage — objects are already gone by tombstone time", async () => {
  deletedObjects.length = 0;
  const store = makeStore([
    row("old-tombstone", 1, {deletedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)}),
  ]);
  const service = createCharacterImageService(store.repo as never, storage as never);
  await service.sweepExpiredTombstones(30);
  assert.deepEqual(deletedObjects, []);
});
