export interface Config {
  github: {
    token: string;
    webhookSecret?: string;
  };
  llm: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  email: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    to: string;
  };
  app: {
    port: number;
    scanInterval: string;
    validationUrl: string;
  };
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  createdAt: Date;
  updatedAt: Date;
  user: {
    login: string;
  };
}

export interface FixProposal {
  id: string;
  issueNumber: number;
  title: string;
  description: string;
  codeChanges: CodeChange[];
  explanation: string;
  confidence: number;
  createdAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
}

export interface CodeChange {
  filePath: string;
  originalCode: string;
  newCode: string;
  explanation: string;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  branch: string;
  url: string;
}

export interface TestResult {
  passed: boolean;
  output: string;
  error?: string;
  duration: number;
}