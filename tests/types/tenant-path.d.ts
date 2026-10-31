/** Type surface for the actual route helper used by the browser DOM-model tests. */
declare module '*web/tenant-path.mjs' {
  export function tenantClientOptions(
    profile: { tenant: { id: string }; deployment?: { url?: string } } | null | undefined,
    location?: { href: string },
  ): { basePath?: string; origin?: string };
}
