import express from 'express';
import { config } from './config';
import { getIssue, getFileContent, getDirectoryContents } from './services/github';
import { analyzeIssue } from './services/llm';
import { sendAnalysisEmail } from './services/email';
import { logger } from './logger';

const app = express();
app.use(express.json());

// Code récupéré avec limite de profondeur et de fichiers
async function gatherCodeContext(owner: string, repo: string, issue: any): Promise<string> {
  const context: string[] = [];
  const processedFiles = new Set<string>();
  
  // 1. Lire les fichiers de config
  const configFiles = ['README.md', 'Cargo.toml', 'package.json', 'go.mod', 'pyproject.toml'];
  for (const file of configFiles) {
    const content = await getFileContent(owner, repo, file);
    if (content) context.push(`\n=== ${file} ===\n${content.substring(0, 1000)}`);
  }

  // 2. Explorer récursivement tous les dossiers
  async function exploreDir(path: string, depth: number): Promise<void> {
    if (depth > 3 || processedFiles.size > 50) return; // Limite: 3 niveaux, 50 fichiers
    
    const items = await getDirectoryContents(owner, repo, path);
    
    for (const item of items) {
      if (processedFiles.has(item.path)) continue;
      
      if (item.type === 'dir') {
        // Ignorer les dossiers inutiles
        if (['node_modules', 'target', '.git', 'dist', 'build'].some(skip => item.name === skip)) {
          continue;
        }
        await exploreDir(item.path, depth + 1);
      } else if (item.type === 'file') {
        // Ne garder que les fichiers source
        if (isSourceFile(item.name)) {
          const content = await getFileContent(owner, repo, item.path);
          if (content) {
            // Tronquer les gros fichiers
            let truncated = content;
            if (content.length > 2000) {
              truncated = content.substring(0, 1000) + '\n\n... [truncated] ...\n\n' + content.substring(content.length - 500);
            }
            context.push(`\n=== ${item.path} ===\n${truncated}`);
            processedFiles.add(item.path);
          }
        }
      }
    }
  }
  
  await exploreDir('', 0);
  
  // 3. Chercher les fichiers mentionnés dans l'issue et les ajouter en priorité
  const mentionedFiles = extractFileReferences(issue.title + ' ' + issue.body);
  for (const filePath of mentionedFiles) {
    if (!processedFiles.has(filePath)) {
      const content = await getFileContent(owner, repo, filePath);
      if (content) {
        context.unshift(`\n=== ${filePath} (mentioned in issue) ===\n${content.substring(0, 2000)}`);
        processedFiles.add(filePath);
      }
    }
  }
  
  return context.join('\n');
}

function isSourceFile(filename: string): boolean {
  const exts = ['.rs', '.ts', '.js', '.py', '.go', '.java', '.cpp', '.c', '.h', '.cs', '.php'];
  return exts.some(ext => filename.toLowerCase().endsWith(ext));
}

function extractFileReferences(text: string): string[] {
  const matches = text.match(/[\w\/]+\.(?:rs|ts|js|py|go|java|cpp|c|h|cs|php)/g) || [];
  return [...new Set(matches)];
}

// Route principale: analyser une issue
app.post('/analyze', async (req, res) => {
  const { issueUrl } = req.body;
  
  if (!issueUrl) {
    return res.status(400).json({ error: 'Missing issueUrl. Format: https://github.com/owner/repo/issues/123' });
  }
  
  // Parse URL
  const match = issueUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/(?:issues|pull)\/(\d+)/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  const [, owner, repo, issueNumber] = match;
  const repoUrl = `https://github.com/${owner}/${repo}`;
  
  try {
    logger.info(`Processing issue #${issueNumber} from ${owner}/${repo}`);
    
    // 1. Récupérer l'issue
    const issue = await getIssue(owner, repo, parseInt(issueNumber));
    logger.info(`Issue retrieved: ${issue.title}`);
    
    // 2. Récupérer le code contexte (TOUT le repo)
    logger.info('Gathering code context...');
    const codeContext = await gatherCodeContext(owner, repo, issue);
    logger.info(`Context gathered: ${codeContext.length} chars`);
    
    // 3. Analyser avec LLM
    const result = await analyzeIssue(issue, codeContext);
    logger.info(`Analysis complete: shouldFix=${result.shouldFix}, confidence=${result.confidence}`);
    
    // 4. Envoyer email
    await sendAnalysisEmail(issue, repoUrl, result);
    
    res.json({
      success: true,
      issue: { number: issue.number, title: issue.title },
      analysis: {
        shouldFix: result.shouldFix,
        confidence: result.confidence,
        reason: result.reason,
        proposedChanges: result.codeChanges?.length || 0,
      },
    });
    
  } catch (error: any) {
    logger.error('Analysis failed', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(config.app.port, () => {
  logger.info(`Server running on port ${config.app.port}`);
});