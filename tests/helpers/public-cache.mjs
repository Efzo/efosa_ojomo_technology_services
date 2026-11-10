// Existing content tests isolate database behavior; caching has its own tests.
export function publicCacheMock(mocks) {
  return {
    publicRead: (_key, read) => read(),
    revalidatePublicPath: (...args) => mocks['next/cache']?.revalidatePath(...args),
  };
}
