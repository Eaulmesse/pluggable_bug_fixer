import { Octokit } from 'octokit';
import { config } from '../config';
import { Issue } from '../types';

export async function getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
  const octokit = new Octokit({ auth: config.github.token });
  
  const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
  
  return {
    number: data.number,
    title: data.title,
    body: data.body || '',
    labels: data.labels.map((l: any) => typeof l === 'string' ? l : l.name || ''),
  };
}

export async function getFileContent(owner: string, repo: string, path: string): Promise<string | null> {
  const octokit = new Octokit({ auth: config.github.token });
  
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    
    if ('content' in data && data.content) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

export async function getDirectoryContents(owner: string, repo: string, path: string): Promise<{ name: string; type: string; path: string }[]> {
  const octokit = new Octokit({ auth: config.github.token });
  
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    
    if (Array.isArray(data)) {
      return data.map((item: any) => ({ name: item.name, type: item.type, path: item.path }));
    }
    return [];
  } catch {
    return [];
  }
}