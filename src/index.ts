import express from 'express';
import { config } from './config';
import { getIssue, getFileContent, getDirectoryContents } from './services/github';
import { identifyRequiredFiles, analyzeIssue } from './services/llm';
import { sendAnalysisEmail } from './services/email';
import { logger } from './logger';

const app = express();
app.use(express.json());

// Récupère la structure du repo (uniquement les noms de fichiers/répertoires)
async function getRepoStructure(owner: string, repo: string, path: string = '', depth: number = 0): Promise<string> {
  if (depth > 3) return '';
  
  const items = await getDirectoryContents(owner, repo, path);
  let structure = '';
  
  for (const item of items) {
    if (['node_modules', 'target', '.git', 'dist', 'build'].includes(item.name)) {
      continue;
    }
    
    const indent = '  '.repeat(depth);
    structure += `${indent}${item.type === 'dir' ? '📁' : '📄'} ${item.path}\n`;
    
    if (item.type === 'dir') {
      const subStructure = await getRepoStructure(owner, repo, item.path, depth + 1);
      structure += subStructure;
    }
  }
  
  return structure;
}

// Récupère le contenu des fichiers spécifiques
async function getFilesContent(owner: string, repo: string, filePaths: string[]): Promise<string> {
  const contents: string[] = [];
  
  for (const filePath of filePaths) {
    const content = await getFileContent(owner, repo, filePath);
    if (content) {
      contents.push(`\n=== ${filePath} ===\n${content}`);
    }
  }
  
  return contents.join('\n');
}

// Route principale: analyser une issue avec récupération intelligente des fichiers
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
    logger.info(`🔍 Processing issue #${issueNumber} from ${owner}/${repo}`);
    
    // ÉTAPE 1: Récupérer l'issue
    const issue = await getIssue(owner, repo, parseInt(issueNumber));
    logger.info(`📋 Issue: ${issue.title}`);
    
    // ÉTAPE 2: Récupérer la structure du repo (uniquement les noms)
    logger.info('📁 Getting repository structure...');
    const repoStructure = await getRepoStructure(owner, repo);
    logger.info(`Found repository structure (${repoStructure.split('\n').length} items)`);
    
    // ÉTAPE 3: L'IA identifie quels fichiers sont nécessaires
    logger.info('🤖 Identifying required files...');
    const requiredFiles = await identifyRequiredFiles(issue, repoStructure);
    logger.info(`Required files: ${requiredFiles.length > 0 ? requiredFiles.join(', ') : 'None identified'}`);
    
    // ÉTAPE 4: Récupérer le contenu des fichiers identifiés + fichiers mentionnés dans l'issue
    const mentionedFiles = extractFileReferences(issue.title + ' ' + issue.body);
    const allFilesToFetch = [...new Set([...requiredFiles, ...mentionedFiles])];
    
    logger.info(`📄 Fetching ${allFilesToFetch.length} specific files...`);
    let codeContext = await getFilesContent(owner, repo, allFilesToFetch);
    
    // Si aucun fichier spécifique n'a été trouvé, récupérer quelques fichiers clés
    if (!codeContext) {
      logger.info('No specific files found, fetching key files...');
      const keyFiles = ['README.md', 'Cargo.toml', 'package.json'];
      for (const file of keyFiles) {
        const content = await getFileContent(owner, repo, file);
        if (content) {
          codeContext += `\n=== ${file} ===\n${content.substring(0, 1000)}\n`;
        }
      }
    }
    
    logger.info(`Total context size: ${codeContext.length} chars`);
    
    // ÉTAPE 5: Analyser avec le contexte complet
    logger.info('🧠 Analyzing with full context...');
    const result = await analyzeIssue(issue, codeContext);
    logger.info(`✅ Analysis: shouldFix=${result.shouldFix}, confidence=${result.confidence}`);
    
    // ÉTAPE 6: Envoyer email
    await sendAnalysisEmail(issue, repoUrl, result);
    
    res.json({
      success: true,
      issue: { number: issue.number, title: issue.title },
      filesAnalyzed: allFilesToFetch.length,
      analysis: {
        shouldFix: result.shouldFix,
        confidence: result.confidence,
        reason: result.reason,
        proposedChanges: result.codeChanges?.length || 0,
      },
      filesRequested: requiredFiles,
      filesMentioned: mentionedFiles,
    });
    
  } catch (error: any) {
    logger.error('❌ Analysis failed', error);
    res.status(500).json({ error: error.message });
  }
});

function extractFileReferences(text: string): string[] {
  const matches = text.match(/[\w\/]+\.(?:rs|ts|js|py|go|java|cpp|c|h|cs|php)/g) || [];
  return [...new Set(matches)];
}

app.listen(config.app.port, () => {
  logger.info(`🚀 Server running on port ${config.app.port}`);
});