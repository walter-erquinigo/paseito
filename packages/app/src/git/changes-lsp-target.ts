export interface ChangesLspTarget {
  filePath: string;
  lineNumber: number;
  column: number;
  clientX: number;
  clientY: number;
}

export function resolveChangesLspTarget(_event: MouseEvent): ChangesLspTarget | null {
  return null;
}
