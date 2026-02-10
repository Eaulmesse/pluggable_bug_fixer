import { Router } from 'express';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'pluggable-bug-fixer' });
});

// List pending proposals
router.get('/proposals', (req, res) => {
  res.json({ message: 'List proposals endpoint - TODO' });
});

// Approve a proposal
router.post('/validate/:proposalId/approve', (req, res) => {
  const { proposalId } = req.params;
  res.json({ message: `Approve proposal ${proposalId} - TODO` });
});

// Reject a proposal
router.post('/validate/:proposalId/reject', (req, res) => {
  const { proposalId } = req.params;
  res.json({ message: `Reject proposal ${proposalId} - TODO` });
});

// Manual scan trigger
router.post('/scan', (req, res) => {
  res.json({ message: 'Manual scan triggered - TODO' });
});

export default router;