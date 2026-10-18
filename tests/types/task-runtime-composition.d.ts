declare module '*server/task-runtime-composition.mjs' {
  export function composeTaskAuthOptions(input: unknown): Readonly<{
    taskChannelBindings?: Readonly<Record<string, unknown>>;
    [key: string]: unknown;
  }>;
}
