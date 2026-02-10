import { Octokit } from 'octokit';
import { config } from '../config';
import { Issue, PullRequest } from '../types';
import { logger } from '../utils/logger';

// Octokit types
type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  labels: Array<string | { name?: string }>;
  state: string;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
};

type ContentItem = {
  type: string;
  path: string;
};

export class GitHubService {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(repositoryUrl: string) {
    this.octokit = new Octokit({
      auth: config.github.token,
    });

    const { owner, repo } = this.parseRepositoryUrl(repositoryUrl);
    this.owner = owner;
    this.repo = repo;
  }

  private parseRepositoryUrl(url: string): { owner: string; repo: string } {
    // Handle both full URL and owner/repo format
    if (url.includes('github.com')) {
      const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!match) {
        throw new Error(`Invalid GitHub repository URL: ${url}`);
      }
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }

    // Handle owner/repo format
    const parts = url.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid repository format. Expected "owner/repo" or full URL`);
    }
    return { owner: parts[0], repo: parts[1] };
  }

  async getIssues(labels?: string[]): Promise<Issue[]> {
    try {
      logger.info(`Fetching issues for ${this.owner}/${this.repo}`, { labels: labels || 'all' });

      const params: any = {
        owner: this.owner,
        repo: this.repo,
        state: 'open',
        sort: 'updated',
        direction: 'desc',
      };

      // Only add labels filter if specified
      if (labels && labels.length > 0) {
        params.labels = labels.join(',');
      }

      const { data } = await this.octokit.rest.issues.listForRepo(params);

      return (data as GitHubIssue[]).map((issue: GitHubIssue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        labels: issue.labels.map((label: string | { name?: string }) =>
          typeof label === 'string' ? label : label.name || ''
        ),
        state: issue.state,
        createdAt: new Date(issue.created_at),
        updatedAt: new Date(issue.updated_at),
        user: {
          login: issue.user?.login || 'unknown',
        },
      }));
    } catch (error) {
      logger.error('Failed to fetch issues', { error, owner: this.owner, repo: this.repo });
      throw error;
    }
  }

  async getIssue(issueNumber: number): Promise<Issue> {
    try {
      logger.info(`Fetching issue #${issueNumber}`, { owner: this.owner, repo: this.repo });

      const { data } = await this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });

      const issue = data as GitHubIssue;
      return {
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        labels: issue.labels.map((label: string | { name?: string }) =>
          typeof label === 'string' ? label : label.name || ''
        ),
        state: issue.state,
        createdAt: new Date(issue.created_at),
        updatedAt: new Date(issue.updated_at),
        user: {
          login: issue.user?.login || 'unknown',
        },
      };
    } catch (error) {
      logger.error('Failed to fetch issue', { error, issueNumber });
      throw error;
    }
  }

  async getRepositoryContent(path: string, ref?: string): Promise<string> {
    try {
      logger.info(`Fetching repository content`, { path, ref });

      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
      });

      if (Array.isArray(data)) {
        // It's a directory, return file list
        return data.map((item: ContentItem) => `${item.type}: ${item.path}`).join('\n');
      }

      if ('content' in data && data.content) {
        // It's a file, decode content
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

      return '';
    } catch (error) {
      logger.error('Failed to fetch repository content', { error, path });
      throw error;
    }
  }

  async getFileContent(filePath: string, ref?: string): Promise<string | null> {
    try {
      logger.info(`Fetching file content`, { filePath, ref });

      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        ref,
      });

      if (Array.isArray(data)) {
        logger.warn(`Path is a directory, not a file`, { filePath });
        return null;
      }

      if ('content' in data && data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

      return null;
    } catch (error: any) {
      if (error.status === 404) {
        logger.warn(`File not found`, { filePath });
        return null;
      }
      logger.error('Failed to fetch file content', { error, filePath });
      throw error;
    }
  }

  async createBranch(branchName: string, baseBranch: string = 'main'): Promise<void> {
    try {
      logger.info(`Creating branch`, { branchName, baseBranch });

      // Get the SHA of the base branch
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${baseBranch}`,
      });

      // Create new branch
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branchName}`,
        sha: refData.object.sha,
      });

      logger.info(`Branch created successfully`, { branchName });
    } catch (error) {
      logger.error('Failed to create branch', { error, branchName });
      throw error;
    }
  }

  async updateFile(
    filePath: string,
    content: string,
    message: string,
    branch: string,
    sha?: string
  ): Promise<void> {
    try {
      logger.info(`Updating file`, { filePath, branch });

      // Get current file SHA if not provided
      let fileSha = sha;
      if (!fileSha) {
        try {
          const { data } = await this.octokit.rest.repos.getContent({
            owner: this.owner,
            repo: this.repo,
            path: filePath,
            ref: branch,
          });

          if (!Array.isArray(data) && 'sha' in data) {
            fileSha = data.sha;
          }
        } catch (error: any) {
          if (error.status !== 404) {
            throw error;
          }
          // File doesn't exist, will create new
        }
      }

      // Encode content to base64
      const contentBase64 = Buffer.from(content).toString('base64');

      // Create or update file
      await this.octokit.rest.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        message,
        content: contentBase64,
        branch,
        sha: fileSha,
      });

      logger.info(`File updated successfully`, { filePath });
    } catch (error) {
      logger.error('Failed to update file', { error, filePath });
      throw error;
    }
  }

  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string = 'main'
  ): Promise<PullRequest> {
    try {
      logger.info(`Creating pull request`, { title, head, base });

      const { data } = await this.octokit.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        head,
        base,
      });

      return {
        number: data.number,
        title: data.title,
        body: data.body || '',
        branch: head,
        url: data.html_url,
      };
    } catch (error) {
      logger.error('Failed to create pull request', { error, title });
      throw error;
    }
  }

  async addCommentToIssue(issueNumber: number, body: string): Promise<void> {
    try {
      logger.info(`Adding comment to issue #${issueNumber}`);

      await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body,
      });

      logger.info(`Comment added successfully`, { issueNumber });
    } catch (error) {
      logger.error('Failed to add comment', { error, issueNumber });
      throw error;
    }
  }

  async getDefaultBranch(): Promise<string> {
    try {
      const { data } = await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: this.repo,
      });

      return data.default_branch;
    } catch (error) {
      logger.error('Failed to get default branch', { error });
      return 'main'; // Fallback
    }
  }
}

// Factory function for creating service instances
export function createGitHubService(repositoryUrl: string): GitHubService {
  return new GitHubService(repositoryUrl);
}