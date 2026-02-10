import { config } from '../config';
import { FixProposal, Issue, AnalysisResult } from '../types';
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

  async analyzeIssue(issue: Issue, repositoryContext: string): Promise<AnalysisResult> {
    try {
      llmLog.info(`Analyzing issue #${issue.number}`, { title: issue.title });

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: `You are an expert code reviewer and bug fixer. Analyze GitHub issues and propose concrete code fixes.

Rules:
1. Only propose fixes if you're confident about the solution
2. Always explain WHY you can or cannot fix the issue
3. If it's a feature request (not a bug), explain why no code fix is needed
4. If confidence is low, explain what information is missing
5. Return response in this JSON format:
{
  "shouldFix": boolean,
  "confidence": number (0-100),
  "reason": "Detailed explanation of why this can or cannot be fixed automatically",
  "title": "Brief fix title (only if shouldFix=true)",
  "description": "Detailed explanation (only if shouldFix=true)",
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
        return {
          shouldFix: false,
          confidence: 0,
          reason: 'Failed to get response from AI model',
        };
      }

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/({[\s\S]*})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;

      const analysis = JSON.parse(jsonStr);

      // If not confident enough or shouldn't fix, return with reason
      if (!analysis.shouldFix || analysis.confidence < 70) {
        llmLog.info(`Issue #${issue.number} skipped`, {
          shouldFix: analysis.shouldFix,
          confidence: analysis.confidence,
          reason: analysis.reason,
        });
        return {
          shouldFix: false,
          confidence: analysis.confidence || 0,
          reason: analysis.reason || 'No fix proposed - insufficient confidence or not a bug',
        };
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

      return {
        shouldFix: true,
        confidence: analysis.confidence,
        reason: analysis.reason || 'Fix proposed with high confidence',
        proposal,
      };
    } catch (error) {
      llmLog.error('Failed to analyze issue', { error, issueNumber: issue.number });
      return {
        shouldFix: false,
        confidence: 0,
        reason: `Error during analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
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