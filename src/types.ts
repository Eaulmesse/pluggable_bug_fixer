export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface AnalysisResult {
  shouldFix: boolean;
  confidence: number;
  reason: string;
  title?: string;
  description?: string;
  codeChanges?: CodeChange[];
}

export interface CodeChange {
  filePath: string;
  explanation: string;
  originalCode: string;
  newCode: string;
}