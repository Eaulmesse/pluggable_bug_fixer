import { config } from '../config';
import { Issue, AnalysisResult } from '../types';
import { logger } from '../logger';

// ÉTAPE 1: Analyser l'issue pour identifier les fichiers nécessaires
export async function identifyRequiredFiles(issue: Issue, repoStructure: string): Promise<string[]> {
  logger.info(`Identifying required files for issue #${issue.number}`);

  const prompt = `Analyze this GitHub issue and determine which source code files need to be examined to fix the bug.

ISSUE #${issue.number}: ${issue.title}

DESCRIPTION:
${issue.body}

REPOSITORY STRUCTURE:
${repoStructure}

TASK:
Based on the issue description, identify the specific files that likely contain:
1. The bug location
2. Related functions/modules mentioned
3. Type definitions
4. Configuration or enum definitions

Respond ONLY with a JSON array of file paths:
["path/to/file1.rs", "path/to/file2.rs", "crates/router/src/types/payouts.rs"]

If you cannot determine specific files, respond with: []`;

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
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data: any = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) return [];

    // Extract JSON array
    const jsonMatch = content.match(/\[.*\]/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return [];
  } catch (error) {
    logger.error('Failed to identify files', error);
    return [];
  }
}

// ÉTAPE 2: Analyser avec le contexte complet
export async function analyzeIssue(issue: Issue, codeContext: string): Promise<AnalysisResult> {
  logger.info(`Analyzing issue #${issue.number} with full context`);

  const prompt = `You are an expert code reviewer. Analyze this GitHub issue with the provided code context and propose a concrete fix.

ISSUE #${issue.number}: ${issue.title}

DESCRIPTION:
${issue.body}

CODE CONTEXT:
${codeContext}

TASK:
You now have all the relevant source code files. Analyze the bug and propose a specific fix.

Respond in JSON format:
{
  "shouldFix": boolean,
  "confidence": number (0-100),
  "reason": "Explanation of the bug and why you can/cannot fix it",
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

Set shouldFix=true ONLY if:
- You can clearly see the bug in the provided code
- You have the exact file content needed
- You're confident about the fix (confidence >= 70)

Be very specific in originalCode - include enough context (5-10 lines) to uniquely identify the location.`;

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