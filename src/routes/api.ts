import { Router } from 'express';
import { BugFixerAgent, createBugFixerAgent } from '../agents/bugFixer';
import { createGitHubService } from '../services/github';
import { createEmailService } from '../services/email';
import { logger } from '../utils/logger';

// Store agents per repository
const agents: Map<string, BugFixerAgent> = new Map();

function getOrCreateAgent(repositoryUrl: string): BugFixerAgent {
  if (!agents.has(repositoryUrl)) {
    const agent = createBugFixerAgent({
      repositoryUrl,
      workingDir: `./repos/${repositoryUrl.replace(/[^a-zA-Z0-9]/g, '_')}`,
    });
    agents.set(repositoryUrl, agent);
  }
  return agents.get(repositoryUrl)!;
}

const router = Router();

// Health check
router.get('/health', async (req, res) => {
  try {
    const emailService = createEmailService();
    const emailConnected = await emailService.verifyConnection();

    res.json({
      status: 'ok',
      service: 'pluggable-bug-fixer',
      email: emailConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: 'Health check failed',
    });
  }
});

// NEW: Analyze a specific issue with full repo context
router.post('/analyze', async (req, res) => {
  const { issueUrl } = req.body;

  if (!issueUrl) {
    return res.status(400).json({ error: 'Missing issueUrl in body. Format: https://github.com/owner/repo/issues/123' });
  }

  // Parse issue URL to extract owner, repo, and issue number
  const urlMatch = issueUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/(?:issues|pull)\/(\d+)/);
  if (!urlMatch) {
    return res.status(400).json({ 
      error: 'Invalid issueUrl format. Expected: https://github.com/owner/repo/issues/123 or https://github.com/owner/repo/pull/123' 
    });
  }

  const [, owner, repo, issueNumber] = urlMatch;
  const repositoryUrl = `https://github.com/${owner}/${repo}`;

  try {
    logger.info(`🔍 Fetching issue #${issueNumber} from ${owner}/${repo}`);

    // Get or create agent for this repository
    const agent = getOrCreateAgent(repositoryUrl);
    
    // Fetch issue details from GitHub
    const github = createGitHubService(repositoryUrl);
    const issue = await github.getIssue(parseInt(issueNumber, 10));

    logger.info(`📋 Analyzing issue #${issue.number}`, { 
      title: issue.title,
      labels: issue.labels 
    });

    // Process the specific issue with full repo context
    const proposal = await agent.analyzeSingleIssue(issue);

    if (!proposal) {
      return res.json({
        success: true,
        analyzed: true,
        proposalCreated: false,
        message: 'Issue analyzed but no fix was proposed (not a bug or confidence too low)',
        issue: {
          number: issue.number,
          title: issue.title,
          url: issueUrl,
        },
      });
    }

    res.json({
      success: true,
      analyzed: true,
      proposalCreated: true,
      issue: {
        number: issue.number,
        title: issue.title,
        url: issueUrl,
      },
      proposal: {
        id: proposal.id,
        issueNumber: proposal.issueNumber,
        title: proposal.title,
        confidence: proposal.confidence,
        description: proposal.description,
        codeChangesCount: proposal.codeChanges.length,
      },
      message: 'Fix proposal created and validation email sent',
    });

  } catch (error: any) {
    logger.error('Failed to analyze issue', { error, issueUrl });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze issue',
    });
  }
});

// NEW: Get full repository context (optionally for a specific issue)
router.get('/context', async (req, res) => {
  const repositoryUrl = req.query.repo as string;
  const issueNumber = req.query.issue as string;

  if (!repositoryUrl) {
    return res.status(400).json({ error: 'Missing repository URL (?repo=owner/repo)' });
  }

  try {
    logger.info(`📂 Fetching repository context`, { repository: repositoryUrl, issue: issueNumber || 'none' });

    const agent = getOrCreateAgent(repositoryUrl);
    
    // If issue number provided, fetch it and get contextualized repo context
    let issue = undefined;
    if (issueNumber) {
      const github = createGitHubService(repositoryUrl);
      issue = await github.getIssue(parseInt(issueNumber, 10));
      logger.info(`Contextualizing for issue #${issueNumber}`, { title: issue.title });
    }
    
    const context = await agent.getRepositoryContext(issue);

    res.json({
      success: true,
      repository: repositoryUrl,
      issue: issueNumber ? { number: parseInt(issueNumber, 10), title: issue?.title } : undefined,
      context: context.substring(0, 10000), // Limit response size
      truncated: context.length > 10000,
      totalSize: context.length,
    });

  } catch (error: any) {
    logger.error('Failed to fetch repository context', { error, repositoryUrl });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch repository context',
    });
  }
});

// List pending proposals
router.get('/proposals', (req, res) => {
  const repositoryUrl = req.query.repo as string;

  if (!repositoryUrl) {
    return res.status(400).json({ error: 'Missing repository URL (?repo=owner/repo)' });
  }

  const agent = getOrCreateAgent(repositoryUrl);
  const proposals = agent.getPendingProposals();

  res.json({
    repository: repositoryUrl,
    proposals: proposals.map((p) => ({
      id: p.id,
      issueNumber: p.issueNumber,
      title: p.title,
      confidence: p.confidence,
      createdAt: p.createdAt,
    })),
    count: proposals.length,
  });
});

// Get proposal details
router.get('/proposals/:proposalId', (req, res) => {
  const { proposalId } = req.params;
  const repositoryUrl = req.query.repo as string;

  if (!repositoryUrl) {
    return res.status(400).json({ error: 'Missing repository URL (?repo=owner/repo)' });
  }

  const agent = getOrCreateAgent(repositoryUrl);
  const proposal = agent.getProposal(proposalId);

  if (!proposal) {
    return res.status(404).json({ error: 'Proposal not found' });
  }

  res.json(proposal);
});

// Approve a proposal
router.post('/validate/:proposalId/approve', async (req, res) => {
  const { proposalId } = req.params;
  const repositoryUrl = req.body.repo || req.query.repo;

  if (!repositoryUrl) {
    return res.status(400).json({ error: 'Missing repository URL (body.repo or query.repo)' });
  }

  try {
    logger.info(`✅ Approving proposal ${proposalId}`, { repositoryUrl });

    const agent = getOrCreateAgent(repositoryUrl);
    await agent.approveProposal(proposalId);

    res.json({
      success: true,
      message: 'Proposal approved and PR created',
      proposalId,
    });
  } catch (error: any) {
    logger.error('Failed to approve proposal', { error, proposalId });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to approve proposal',
    });
  }
});

// Reject a proposal
router.post('/validate/:proposalId/reject', async (req, res) => {
  const { proposalId } = req.params;
  const repositoryUrl = req.body.repo || req.query.repo;

  if (!repositoryUrl) {
    return res.status(400).json({ error: 'Missing repository URL (body.repo or query.repo)' });
  }

  try {
    logger.info(`❌ Rejecting proposal ${proposalId}`, { repositoryUrl });

    const agent = getOrCreateAgent(repositoryUrl);
    await agent.rejectProposal(proposalId);

    res.json({
      success: true,
      message: 'Proposal rejected',
      proposalId,
    });
  } catch (error: any) {
    logger.error('Failed to reject proposal', { error, proposalId });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to reject proposal',
    });
  }
});

// Legacy: Manual scan trigger (optional - can be removed if not needed)
router.post('/scan', async (req, res) => {
  const repositoryUrl = req.body.repo || req.query.repo;
  const limit = req.body.limit || req.query.limit;

  if (!repositoryUrl) {
    return res.status(400).json({ error: 'Missing repository URL (body.repo or query.repo)' });
  }

  try {
    logger.info(`🔍 Triggering manual scan`, { repositoryUrl, limit: limit || 'unlimited' });

    const agent = getOrCreateAgent(repositoryUrl);

    // Parse limit if provided
    let limitNumber: number | undefined;
    if (limit) {
      limitNumber = parseInt(limit as string, 10);
      if (isNaN(limitNumber) || limitNumber < 1) {
        return res.status(400).json({ error: 'Invalid limit parameter (must be a positive number)' });
      }
    }

    // Run scan asynchronously
    agent.scanAndAnalyze(limitNumber).catch((error) => {
      logger.error('Scan failed', { error, repositoryUrl });
    });

    res.json({
      success: true,
      message: `Scan triggered${limitNumber ? `, limited to ${limitNumber} issues` : ' (all issues)'}. Check email for proposals.`,
      repository: repositoryUrl,
      limit: limitNumber || 'unlimited',
    });
  } catch (error: any) {
    logger.error('Failed to trigger scan', { error, repositoryUrl });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to trigger scan',
    });
  }
});

// Test email configuration
router.post('/test/email', async (req, res) => {
  try {
    const emailService = createEmailService();
    const connected = await emailService.verifyConnection();

    if (!connected) {
      return res.status(500).json({
        success: false,
        error: 'Email service not connected',
      });
    }

    res.json({
      success: true,
      message: 'Email service connected successfully',
    });
  } catch (error: any) {
    logger.error('Failed to verify email connection', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to verify email connection',
    });
  }
});

export default router;