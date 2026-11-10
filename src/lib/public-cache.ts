import { unstable_cache, revalidatePath, updateTag } from "next/cache";

export const PUBLIC_CONTENT_TAG = "published-content-v1";

/** Cache only request-independent public reads. Keep errors outside the cache so
 * a temporary database outage never replaces a good entry with fallback content.
 * No timed expiry: publishing invalidates the data, even after long inactivity.
 */
export function publicRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  return unstable_cache(read, [PUBLIC_CONTENT_TAG, key], {
    tags: [PUBLIC_CONTENT_TAG],
    revalidate: false,
  })();
}

/** Server Actions expire shared data as well as the affected route. */
export function revalidatePublicPath(path: string, type?: "layout" | "page") {
  updateTag(PUBLIC_CONTENT_TAG);
  revalidatePath(path, type);
}
