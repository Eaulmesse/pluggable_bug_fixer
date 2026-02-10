import { config } from '../config';
import { Issue, AnalysisResult } from '../types';
import { logger } from '../logger';

export async function analyzeIssue(issue: Issue, codeContext: string): Promise<AnalysisResult> {
  logger.info(`Analyzing issue #${issue.number}`);

  const prompt = `You are an expert code reviewer. Analyze this GitHub issue and the provided code context.

ISSUE #${issue.number}: ${issue.title}

DESCRIPTION:
${issue.body}

CODE CONTEXT:
${codeContext}

TASK:
Determine if this issue can be automatically fixed. Consider:
1. Is it a bug (not a feature request)?
2. Do you have enough context from the code to propose a fix?
3. Are the relevant files provided in the context?

Respond in JSON format:
{
  "shouldFix": boolean,
  "confidence": number (0-100),
  "reason": "Detailed explanation of why this can or cannot be fixed",
  "title": "Brief fix title (if shouldFix=true)",
  "description": "Detailed explanation of the fix (if shouldFix=true)",
  "codeChanges": [
    {
      "filePath": "path/to/file",
      "explanation": "Why this change fixes the issue",
      "originalCode": "exact code to find and replace",
      "newCode": "new code to insert"
    }
  ]
}

Only set shouldFix=true if:
- It's clearly a bug
- You can see the relevant code in the context
- You're confident about the fix (confidence >= 70)

If code is missing or it's a feature request, explain what's needed in the "reason" field.`;

  try {
    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data: any = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return { shouldFix: false, confidence: 0, reason: 'Empty response from LLM' };
    }

    // Extract JSON
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/({[\s\S]*})/);
    const result = JSON.parse(jsonMatch ? jsonMatch[1] : content);

    return {
      shouldFix: result.shouldFix && result.confidence >= 70,
      confidence: result.confidence || 0,
      reason: result.reason || 'No reason provided',
      title: result.title,
      description: result.description,
      codeChanges: result.codeChanges,
    };
  } catch (error) {
    logger.error('Analysis failed', error);
    return { 
      shouldFix: false, 
      confidence: 0, 
      reason: `Analysis error: ${error instanceof Error ? error.message : 'Unknown'}` 
    };
  }
}