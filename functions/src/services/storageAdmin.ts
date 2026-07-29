import {getStorage} from "firebase-admin/storage";
import * as logger from "firebase-functions/logger";

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;
type BucketProvider = () => Bucket;

const defaultBucketProvider: BucketProvider = () => getStorage().bucket();

/**
 * Server-side Storage operations the client cannot perform: prefix deletes
 * (the client may be offline, or the objects may belong to another device) and
 * signed URLs for public character import.
 */
export const createStorageAdmin = (bucketProvider: BucketProvider = defaultBucketProvider) => ({
  /**
   * List-then-delete loop. Not atomic, but idempotent — a partial failure is
   * safe to re-run, which is exactly what the deletion paths need.
   */
  async deletePrefix(prefix: string): Promise<void> {
    const [files] = await bucketProvider().getFiles({prefix});
    const failed: string[] = [];
    for (const file of files) {
      try {
        await file.delete();
      } catch (error) {
        const code = (error as {code?: number}).code;
        if (code === 404) continue;
        logger.warn("Failed to delete storage object during prefix delete", {
          prefix,
          name: file.name,
          error,
        });
        failed.push(file.name);
      }
    }
    // Every path is attempted before throwing, so a single bad object does not
    // strand the rest. But the throw itself matters: callers delete the DB rows
    // that hold these paths, so swallowing the failure would leave objects no
    // one can find again. Failing keeps the operation retryable.
    if (failed.length > 0) {
      throw new Error(
        `Failed to delete ${failed.length} storage object(s) under prefix ${prefix}: ${failed.join(", ")}`
      );
    }
  },

  async deleteObjects(paths: string[]): Promise<void> {
    const bucket = bucketProvider();
    const failed: string[] = [];
    for (const path of paths) {
      try {
        await bucket.file(path).delete();
      } catch (error) {
        const code = (error as {code?: number}).code;
        if (code === 404) continue;
        logger.warn("Failed to delete storage object", {path, error});
        failed.push(path);
      }
    }
    // Same contract as deletePrefix: attempt all, then fail loudly so the
    // caller does not drop the rows that reference these objects.
    if (failed.length > 0) {
      throw new Error(
        `Failed to delete ${failed.length} storage object(s): ${failed.join(", ")}`
      );
    }
  },

  /**
   * V4 signed read URL, 15 minutes.
   *
   * DEPLOY-TIME TRAP: this requires the runtime service account to hold
   * roles/iam.serviceAccountTokenCreator **on itself**, or the call fails with a
   * signBlob permission error. That is IAM configuration, not a code defect.
   */
  async createSignedUrl(path: string): Promise<string> {
    const [url] = await bucketProvider().file(path).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
  },
});

export const storageAdmin = createStorageAdmin();
