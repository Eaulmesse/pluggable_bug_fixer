import { config } from '../config';
import { FixProposal, Issue } from '../types';
import { logger } from '../utils/logger';

// Use specialized logger for LLM operations
const llmLog = {
  info: (msg: string, meta?: any) => logger.llm(msg, meta),
  warn: (msg: string, meta?: any) => logger.warn(msg, meta),
  error: (msg: string, meta?: any) => logger.error(msg, meta),
};

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class LLMService {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = config.llm.apiKey;
    this.baseUrl = config.llm.baseUrl;
    this.model = config.llm.model;
  }

  async analyzeIssue(issue: Issue, repositoryContext: string): Promise<FixProposal | null> {
    try {
      llmLog.info(`Analyzing issue #${issue.number}`, { title: issue.title });

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: `You are an expert code reviewer and bug fixer. Analyze GitHub issues and propose concrete code fixes.

Rules:
1. Only propose fixes if you're confident about the solution
2. Provide clear explanations
3. Include actual code changes with file paths
4. Return response in this JSON format:
{
  "shouldFix": boolean,
  "confidence": number (0-100),
  "title": "Brief fix title",
  "description": "Detailed explanation",
  "codeChanges": [
    {
      "filePath": "path/to/file",
      "explanation": "Why this change is needed",
      "originalCode": "code to replace (can be empty for new files)",
      "newCode": "new code to insert"
    }
  ]
}`,
        },
        {
          role: 'user',
          content: `Repository Context:\n${repositoryContext}\n\nIssue #${issue.number}: ${issue.title}\n\n${issue.body}`,
        },
      ];

      const response = await this.callLLM(messages);
      const content = response.choices[0]?.message?.content;

      if (!content) {
        llmLog.warn('Empty response from LLM');
        return null;
      }

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/({[\s\S]*})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;

      const analysis = JSON.parse(jsonStr);

      if (!analysis.shouldFix || analysis.confidence < 70) {
        llmLog.info(`Issue #${issue.number} skipped`, {
          shouldFix: analysis.shouldFix,
          confidence: analysis.confidence,
        });
        return null;
      }

      const proposal: FixProposal = {
        id: this.generateProposalId(),
        issueNumber: issue.number,
        title: analysis.title,
        description: analysis.description,
        codeChanges: analysis.codeChanges.map((change: any) => ({
          filePath: change.filePath,
          originalCode: change.originalCode || '',
          newCode: change.newCode,
          explanation: change.explanation,
        })),
        explanation: analysis.description,
        confidence: analysis.confidence,
        createdAt: new Date(),
        status: 'pending',
      };

      llmLog.info(`Generated fix proposal`, {
        proposalId: proposal.id,
        issueNumber: issue.number,
        confidence: proposal.confidence,
      });

      return proposal;
    } catch (error) {
      llmLog.error('Failed to analyze issue', { error, issueNumber: issue.number });
      return null;
    }
  }

  async validateFix(proposal: FixProposal, testOutput: string): Promise<boolean> {
    try {
      llmLog.info(`Validating fix proposal`, { proposalId: proposal.id });

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: `You are a code reviewer. Review the proposed fix and test results. Respond with JSON: { "isValid": boolean, "reason": "explanation" }`,
        },
        {
          role: 'user',
          content: `Fix: ${proposal.title}\nChanges: ${JSON.stringify(proposal.codeChanges)}\n\nTest Results:\n${testOutput}`,
        },
      ];

      const response = await this.callLLM(messages);
      const content = response.choices[0]?.message?.content;

      if (!content) return false;

      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/({[\s\S]*})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;

      const validation = JSON.parse(jsonStr);
      return validation.isValid === true;
    } catch (error) {
      llmLog.error('Failed to validate fix', { error, proposalId: proposal.id });
      return false;
    }
  }

  private async callLLM(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.2,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<LLMResponse>;
  }

  private generateProposalId(): string {
    return `prop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export function createLLMService(): LLMService {
  return new LLMService();
}