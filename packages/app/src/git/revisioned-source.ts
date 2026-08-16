export type SourceDigest = (content: string) => Promise<string>;

export const SOURCE_REVISION_MISMATCH_ERROR =
  "The reconstructed Changes source did not match its expected revision.";

export async function reconstructRevisionedSource(input: {
  lines: readonly string[];
  revision: string;
  digest: SourceDigest;
}): Promise<string> {
  const withoutFinalNewline = input.lines.join("\n");
  if ((await input.digest(withoutFinalNewline)) === input.revision) {
    return withoutFinalNewline;
  }

  const withFinalNewline = `${withoutFinalNewline}\n`;
  if ((await input.digest(withFinalNewline)) === input.revision) {
    return withFinalNewline;
  }

  throw new Error(SOURCE_REVISION_MISMATCH_ERROR);
}
