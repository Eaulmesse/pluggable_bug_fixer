import nodemailer from 'nodemailer';
import { config } from '../config';
import { Issue, AnalysisResult } from '../types';
import { logger } from '../logger';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: { user: config.email.user, pass: config.email.pass },
});

export async function sendAnalysisEmail(issue: Issue, repoUrl: string, result: AnalysisResult): Promise<void> {
  const subject = result.shouldFix 
    ? `[Bug Fix] Proposed fix for #${issue.number}: ${issue.title.substring(0, 50)}`
    : `[Bug Fix] No fix for #${issue.number}: ${issue.title.substring(0, 50)}`;

  const html = result.shouldFix 
    ? generateFixEmail(issue, repoUrl, result)
    : generateNoFixEmail(issue, repoUrl, result);

  await transporter.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject,
    html,
  });

  logger.info('Email sent', { issue: issue.number, shouldFix: result.shouldFix });
}

function generateFixEmail(issue: Issue, repoUrl: string, result: AnalysisResult): string {
  const changes = result.codeChanges?.map(c => `
    <h4>📄 ${c.filePath}</h4>
    <p><em>${c.explanation}</em></p>
    <pre style="background:#f5f5f5;padding:10px;border-radius:5px;"><code>${escapeHtml(c.newCode)}</code></pre>
  `).join('') || '';

  return `
    <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
      <h2>🔧 Fix Proposed</h2>
      <p><strong>Issue:</strong> <a href="${repoUrl}/issues/${issue.number}">#${issue.number}</a> - ${issue.title}</p>
      <p><strong>Confidence:</strong> ${result.confidence}%</p>
      <p><strong>Reason:</strong> ${result.reason}</p>
      <hr/>
      <h3>Changes</h3>
      ${changes}
    </div>
  `;
}

function generateNoFixEmail(issue: Issue, repoUrl: string, result: AnalysisResult): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
      <h2>📋 No Fix Proposed</h2>
      <p><strong>Issue:</strong> <a href="${repoUrl}/issues/${issue.number}">#${issue.number}</a> - ${issue.title}</p>
      <div style="background:#fff3cd;padding:15px;border-radius:5px;margin:20px 0;">
        <h3>Why no fix?</h3>
        <p>${result.reason}</p>
      </div>
      <div style="background:#f8f9fa;padding:15px;border-radius:5px;">
        <h4>Issue Description</h4>
        <pre>${escapeHtml(issue.body)}</pre>
      </div>
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}