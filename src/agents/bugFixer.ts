import { GitHubService, createGitHubService } from '../services/github';
import { LLMService, createLLMService } from '../services/llm';
import { EmailService, createEmailService } from '../services/email';
import { TestRunnerService, createTestRunnerService } from '../services/testRunner';
import { FixProposal, Issue, TestResult } from '../types';
import { logger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface BugFixerConfig {
  repositoryUrl: string;
  workingDir: string;
  labels?: string[];  // Optional - for legacy scan mode
  limit?: number;     // Optional - for legacy scan mode
}

export class BugFixerAgent {
  private github: GitHubService;
  private llm: LLMService;
  private email: EmailService;
  private testRunner: TestRunnerService;
  private config: BugFixerConfig;
  private proposals: Map<string, FixProposal> = new Map();

  constructor(config: BugFixerConfig) {
    this.config = config;
    this.github = createGitHubService(config.repositoryUrl);
    this.llm = createLLMService();
    this.email = createEmailService();
    this.testRunner = createTestRunnerService(config.workingDir);
  }

  async scanAndAnalyze(limit?: number): Promise<void> {
    try {
      const analysisLimit = limit || this.config.limit;
      logger.scan('Starting scan and analyze cycle', { limit: analysisLimit || 'unlimited' });

      // Fetch issues (all issues if no labels specified, with optional limit)
      const issues = await this.github.getIssues(this.config.labels, analysisLimit);
      logger.info(`Found ${issues.length} issues to analyze`);

      for (const issue of issues) {
        await this.processIssue(issue);
      }

      logger.success('Scan and analyze cycle completed');
    } catch (error) {
      logger.error('Scan and analyze cycle failed', { error });
      throw error;
    }
  }

  private async processIssue(issue: Issue): Promise<void> {
    try {
      await this.analyzeSingleIssue(issue);
    } catch (error) {
      logger.error(`Failed to process issue #${issue.number}`, { error });
    }
  }

  /**
   * Analyze a single issue with full repository context
   * Public method for API endpoint
   */
  async analyzeSingleIssue(issue: Issue): Promise<FixProposal | null> {
    logger.info(`Processing issue #${issue.number}`, { title: issue.title });

    // Get full repository context
    const context = await this.getRepositoryContext();

    // Analyze with LLM
    const result = await this.llm.analyzeIssue(issue, context);

    // If no fix proposed, send explanation email
    if (!result.shouldFix || !result.proposal) {
      logger.info(`No fix proposed for issue #${issue.number}`, { reason: result.reason });
      
      // Send email explaining why no fix was proposed
      await this.email.sendNoFixEmail(issue, this.config.repositoryUrl, result.reason);
      
      return null;
    }

    const proposal = result.proposal;

    // Store proposal
    this.proposals.set(proposal.id, proposal);

    // Send validation email
    await this.email.sendValidationEmail(proposal, this.config.repositoryUrl);

    logger.success(`Proposal ${proposal.id} created for issue #${issue.number}`);
    
    return proposal;
  }

  /**
   * Get full repository context for analysis
   * Public method for API endpoint
   */
  async getRepositoryContext(): Promise<string> {
    return this.gatherRepositoryContext();
  }

  async approveProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);

    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== 'pending') {
      throw new Error(`Proposal ${proposalId} is already ${proposal.status}`);
    }

    try {
      logger.info(`🚀 Approving proposal ${proposalId}`);
      proposal.status = 'approved';

      // Clone or pull repository
      await this.prepareRepository();

      // Create branch
      const branchName = `bugfix/issue-${proposal.issueNumber}-${Date.now()}`;
      const baseBranch = await this.github.getDefaultBranch();
      await this.github.createBranch(branchName, baseBranch);

      // Apply changes
      await this.applyChanges(proposal, branchName);

      // Run tests
      const testResult = await this.runTests();

      if (!testResult.passed) {
        logger.error('❌ Tests failed', { output: testResult.output });
        await this.email.sendConfirmationEmail(proposal, '', false);
        proposal.status = 'rejected';
        return;
      }

      // Create PR
      const pr = await this.github.createPullRequest(
        `Fix: ${proposal.title}`,
        this.generatePRBody(proposal),
        branchName,
        baseBranch
      );

      proposal.status = 'applied';

      // Add comment to issue
      await this.github.addCommentToIssue(
        proposal.issueNumber,
        `🔧 A fix has been proposed in PR #${pr.number}: ${pr.url}`
      );

      // Send confirmation
      await this.email.sendConfirmationEmail(proposal, pr.url, true);

      logger.info(`✅ Proposal ${proposalId} applied successfully`, { prUrl: pr.url });
    } catch (error) {
      logger.error(`❌ Failed to apply proposal ${proposalId}`, { error });
      proposal.status = 'rejected';
      await this.email.sendConfirmationEmail(proposal, '', false);
      throw error;
    }
  }

  async rejectProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);

    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    proposal.status = 'rejected';
    logger.info(`Proposal ${proposalId} rejected`);

    // Clean up
    this.proposals.delete(proposalId);
  }

  getPendingProposals(): FixProposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.status === 'pending');
  }

  getProposal(proposalId: string): FixProposal | undefined {
    return this.proposals.get(proposalId);
  }

  private async gatherRepositoryContext(): Promise<string> {
    try {
      logger.info('Gathering repository context');

      // Get root directory structure first
      const rootContent = await this.github.getRepositoryContent('');
      const contextParts: string[] = [`\n=== Repository Root ===\n${rootContent}`];

      // Try to read common config files if they exist
      const filesToRead = ['README.md', 'package.json', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'go.mod', 'tsconfig.json'];

      for (const file of filesToRead) {
        try {
          const content = await this.github.getFileContent(file);
          if (content) {
            contextParts.push(`\n=== ${file} ===\n${content.substring(0, 2000)}`);
          }
        } catch {
          // File might not exist
        }
      }

      // Try common source directories
      const sourceDirs = ['src', 'lib', 'app', 'api', 'src/api'];
      for (const dir of sourceDirs) {
        try {
          const dirContent = await this.github.getRepositoryContent(dir);
          if (dirContent && !dirContent.includes('Not Found')) {
            contextParts.push(`\n=== ${dir}/ Structure ===\n${dirContent.substring(0, 1000)}`);
          }
        } catch {
          // Directory might not exist
        }
      }

      return contextParts.join('\n');
    } catch (error) {
      logger.error('Failed to gather repository context', { error });
      return 'Repository context unavailable';
    }
  }

  private async prepareRepository(): Promise<void> {
    try {
      await fs.access(this.config.workingDir);
      logger.info('Repository already exists, pulling latest changes');
      await execAsync('git pull', { cwd: this.config.workingDir });
    } catch {
      logger.info('Cloning repository');
      await fs.mkdir(this.config.workingDir, { recursive: true });
      await execAsync(`git clone ${this.config.repositoryUrl} .`, {
        cwd: this.config.workingDir,
      });
    }
  }

  private async applyChanges(proposal: FixProposal, branchName: string): Promise<void> {
    logger.info('Applying changes', { changes: proposal.codeChanges.length });

    for (const change of proposal.codeChanges) {
      const filePath = path.join(this.config.workingDir, change.filePath);

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      if (change.originalCode) {
        // Read current file content
        let content = '';
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch {
          // File doesn't exist
        }

        // Replace code
        if (!content.includes(change.originalCode)) {
          throw new Error(`Original code not found in ${change.filePath}`);
        }

        content = content.replace(change.originalCode, change.newCode);
        await fs.writeFile(filePath, content, 'utf-8');
      } else {
        // Create new file
        await fs.writeFile(filePath, change.newCode, 'utf-8');
      }

      // Commit change
      await execAsync(`git add "${change.filePath}"`, { cwd: this.config.workingDir });
      await execAsync(
        `git commit -m "fix: ${change.explanation.substring(0, 50)}"`,
        { cwd: this.config.workingDir }
      );
    }

    // Push branch
    await execAsync(`git push origin ${branchName}`, { cwd: this.config.workingDir });
  }

  private async runTests(): Promise<TestResult> {
    logger.info('Running validation tests');

    // Run lint
    const lintResult = await this.testRunner.runLint();
    if (!lintResult.passed) {
      return lintResult;
    }

    // Run build
    const buildResult = await this.testRunner.runBuild();
    if (!buildResult.passed) {
      return buildResult;
    }

    // Run tests
    const testResult = await this.testRunner.runTests();
    return testResult;
  }

  private generatePRBody(proposal: FixProposal): string {
    const changesMd = proposal.codeChanges
      .map(
        (change) => `
### ${change.filePath}

${change.explanation}

\`\`\`diff
- ${change.originalCode?.replace(/\n/g, '\n- ') || '/* new file */'}
+ ${change.newCode.replace(/\n/g, '\n+ ')}
\`\`\`
`
      )
      .join('\n');

    return `## Fix for Issue #${proposal.issueNumber}

${proposal.description}

### Changes

${changesMd}

---
*This PR was automatically generated with ${proposal.confidence}% confidence.*`;
  }
}

export function createBugFixerAgent(config: BugFixerConfig): BugFixerAgent {
  return new BugFixerAgent(config);
}