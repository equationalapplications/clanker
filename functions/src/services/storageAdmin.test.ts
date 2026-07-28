import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";

const {createStorageAdmin} = await import("./storageAdmin.js");

function fakeBucket() {
  const deleted: string[] = [];
  const listed: string[][] = [];
  return {
    deleted,
    listed,
    bucket: {
      getFiles: async ({prefix}: {prefix: string}) => {
        listed.push([prefix]);
        return [[
          {name: `${prefix}a.webp`, delete: async () => { deleted.push(`${prefix}a.webp`); }},
          {name: `${prefix}b.webp`, delete: async () => { deleted.push(`${prefix}b.webp`); }},
        ]];
      },
      file: (name: string) => ({
        delete: async () => { deleted.push(name); },
        getSignedUrl: async (opts: Record<string, unknown>) => [`https://signed/${name}?exp=${String(opts.expires)}`],
      }),
    },
  };
}

test("deletePrefix lists then deletes every object under the prefix", async () => {
  const {bucket, deleted, listed} = fakeBucket();
  const admin = createStorageAdmin(() => bucket as never);
  await admin.deletePrefix("users/u1/characters/c1/");
  assert.deepEqual(listed, [["users/u1/characters/c1/"]]);
  assert.deepEqual(deleted, ["users/u1/characters/c1/a.webp", "users/u1/characters/c1/b.webp"]);
});

test("deletePrefix is idempotent: a missing object is not an error", async () => {
  const admin = createStorageAdmin(() => ({
    getFiles: async () => [[{
      name: "x", delete: async () => { throw Object.assign(new Error("gone"), {code: 404}); },
    }]],
  }) as never);
  await admin.deletePrefix("users/u1/");
});

test("deleteObjects removes each named object", async () => {
  const {bucket, deleted} = fakeBucket();
  const admin = createStorageAdmin(() => bucket as never);
  await admin.deleteObjects(["users/u1/a.webp", "users/u1/a_thumb.webp"]);
  assert.deepEqual(deleted, ["users/u1/a.webp", "users/u1/a_thumb.webp"]);
});

test("createSignedUrl issues a 15-minute V4 read URL", async () => {
  const {bucket} = fakeBucket();
  const admin = createStorageAdmin(() => bucket as never);
  const before = Date.now();
  const url = await admin.createSignedUrl("users/u1/a.webp");
  assert.match(url, /^https:\/\/signed\/users\/u1\/a\.webp\?exp=/);
  const expires = Number(url.split("exp=")[1]);
  assert.ok(expires >= before + 14 * 60 * 1000);
  assert.ok(expires <= before + 16 * 60 * 1000);
});
