import { Router } from 'express';
import { BugFixerAgent, createBugFixerAgent } from '../agents/bugFixer';
import { createEmailService } from '../services/email';
import { logger } from '../utils/logger';

// Store agents per repository (in production, use Redis or database)
const agents: Map<string, BugFixerAgent> = new Map();

function getOrCreateAgent(repositoryUrl: string): BugFixerAgent {
  if (!agents.has(repositoryUrl)) {
    const agent = createBugFixerAgent({
      repositoryUrl,
      workingDir: `./repos/${repositoryUrl.replace(/[^a-zA-Z0-9]/g, '_')}`,
      labels: ['bug', 'help wanted'],
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
    logger.info(`Approving proposal ${proposalId}`, { repositoryUrl });

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
    logger.info(`Rejecting proposal ${proposalId}`, { repositoryUrl });

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

// Manual scan trigger
router.post('/scan', async (req, res) => {
  const repositoryUrl = req.body.repo || req.query.repo;

  if (!repositoryUrl) {
    return res.status(400).json({ error: 'Missing repository URL (body.repo or query.repo)' });
  }

  try {
    logger.info(`Triggering manual scan`, { repositoryUrl });

    const agent = getOrCreateAgent(repositoryUrl);

    // Run scan asynchronously
    agent.scanAndAnalyze().catch((error) => {
      logger.error('Scan failed', { error, repositoryUrl });
    });

    res.json({
      success: true,
      message: 'Scan triggered. Check email for proposals.',
      repository: repositoryUrl,
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