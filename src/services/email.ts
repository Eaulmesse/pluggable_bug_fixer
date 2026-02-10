import nodemailer from 'nodemailer';
import { config } from '../config';
import { FixProposal, Issue } from '../types';
import { logger } from '../utils/logger';

// Use specialized logger for Email operations
const emailLog = {
  info: (msg: string, meta?: any) => logger.email(msg, meta),
  warn: (msg: string, meta?: any) => logger.warn(msg, meta),
  error: (msg: string, meta?: any) => logger.error(msg, meta),
  debug: (msg: string, meta?: any) => logger.debug(msg, meta),
};

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });

    // Debug logging
    emailLog.debug('Email service configured', {
      host: config.email.host,
      port: config.email.port,
      user: config.email.user,
      from: config.email.from,
      to: config.email.to,
    });
  }

  async sendValidationEmail(proposal: FixProposal, repositoryUrl: string): Promise<void> {
    try {
      emailLog.info(`Sending validation email`, { proposalId: proposal.id });

      const approveUrl = `${config.app.validationUrl}/api/validate/${proposal.id}/approve`;
      const rejectUrl = `${config.app.validationUrl}/api/validate/${proposal.id}/reject`;

      const htmlContent = this.generateEmailHtml(proposal, repositoryUrl, approveUrl, rejectUrl);

      await this.transporter.sendMail({
        from: config.email.from,
        to: config.email.to,
        subject: `[Bug Fixer] Validation Required: ${proposal.title}`,
        html: htmlContent,
        text: this.generateEmailText(proposal, approveUrl, rejectUrl),
      });

      emailLog.info(`Validation email sent successfully`, { proposalId: proposal.id });
    } catch (error) {
      emailLog.error('Failed to send validation email', { error, proposalId: proposal.id });
      throw error;
    }
  }

  async sendConfirmationEmail(proposal: FixProposal, prUrl: string, success: boolean): Promise<void> {
    try {
      emailLog.info(`Sending confirmation email`, { proposalId: proposal.id, success });

      const subject = success
        ? `[Bug Fixer] ✅ PR Created: ${proposal.title}`
        : `[Bug Fixer] ❌ Failed: ${proposal.title}`;

      const htmlContent = success
        ? `<h2>✅ Pull Request Created Successfully</h2>
           <p><strong>Issue:</strong> #${proposal.issueNumber} - ${proposal.title}</p>
           <p><strong>PR URL:</strong> <a href="${prUrl}">${prUrl}</a></p>
           <p>The fix has been applied and tests passed.</p>`
        : `<h2>❌ Failed to Create Pull Request</h2>
           <p><strong>Issue:</strong> #${proposal.issueNumber} - ${proposal.title}</p>
           <p>There was an error while creating the PR. Please check the logs.</p>`;

      await this.transporter.sendMail({
        from: config.email.from,
        to: config.email.to,
        subject,
        html: htmlContent,
      });

      emailLog.info(`Confirmation email sent`, { proposalId: proposal.id, success });
    } catch (error) {
      emailLog.error('Failed to send confirmation email', { error, proposalId: proposal.id });
    }
  }

  async sendNoFixEmail(issue: Issue, repositoryUrl: string, reason: string): Promise<void> {
    try {
      emailLog.info(`Sending no-fix explanation email`, { issueNumber: issue.number });

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
          <h1>📋 Issue Analysis - No Fix Proposed</h1>
          
          <div style="background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 5px solid #ffc107;">
            <h2>⚠️ Analysis Complete</h2>
            <p><strong>Repository:</strong> ${repositoryUrl}</p>
            <p><strong>Issue:</strong> #${issue.number} - ${issue.title}</p>
          </div>

          <div style="background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3>🤔 Why no fix was proposed?</h3>
            <p style="font-size: 16px; line-height: 1.6;">${reason}</p>
          </div>

          <div style="background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h4>📖 Issue Details</h4>
            <pre style="background: white; padding: 10px; border-radius: 3px; overflow-x: auto;">${this.escapeHtml(issue.body || 'No description provided')}</pre>
          </div>

          <div style="margin: 30px 0; padding: 15px; background: #d1ecf1; border-radius: 5px;">
            <p style="margin: 0;"><strong>💡 What you can do:</strong></p>
            <ul>
              <li>If you think this is a bug, add more details to the issue</li>
              <li>Check if the issue has the correct labels (bug, critical, etc.)</li>
              <li>Provide code examples or error messages</li>
              <li>Link to related files or commits</li>
            </ul>
          </div>

          <hr style="margin: 30px 0;">
          <p style="font-size: 12px; color: #666;">
            Issue: <a href="${repositoryUrl}/issues/${issue.number}">#${issue.number}</a><br>
            Analyzed: ${new Date().toISOString()}
          </p>
        </div>
      `;

      const textContent = `
Issue Analysis - No Fix Proposed
=================================

Repository: ${repositoryUrl}
Issue #${issue.number}: ${issue.title}

Why no fix was proposed?
${reason}

Issue Details:
${issue.body || 'No description provided'}

What you can do:
- If you think this is a bug, add more details to the issue
- Check if the issue has the correct labels (bug, critical, etc.)
- Provide code examples or error messages
- Link to related files or commits

Issue: ${repositoryUrl}/issues/${issue.number}
Analyzed: ${new Date().toISOString()}
`;

      await this.transporter.sendMail({
        from: config.email.from,
        to: config.email.to,
        subject: `[Bug Fixer] No Fix Proposed: ${issue.title.substring(0, 50)}${issue.title.length > 50 ? '...' : ''}`,
        html: htmlContent,
        text: textContent,
      });

      emailLog.info(`No-fix email sent successfully`, { issueNumber: issue.number });
    } catch (error) {
      emailLog.error('Failed to send no-fix email', { error, issueNumber: issue.number });
      throw error;
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      emailLog.info('Email service connection verified');
      return true;
    } catch (error: any) {
      emailLog.error('Email service connection failed', {
        error: error.message,
        code: error.code,
        command: error.command,
        response: error.response,
      });
      return false;
    }
  }

  private generateEmailHtml(
    proposal: FixProposal,
    repositoryUrl: string,
    approveUrl: string,
    rejectUrl: string
  ): string {
    const changesHtml = proposal.codeChanges
      .map(
        (change) => `
        <div style="margin: 20px 0; border: 1px solid #ddd; border-radius: 5px;">
          <div style="background: #f5f5f5; padding: 10px; border-bottom: 1px solid #ddd;">
            <strong>📄 ${change.filePath}</strong>
          </div>
          <div style="padding: 10px;">
            <p><em>${change.explanation}</em></p>
            ${change.originalCode ? `
            <div style="background: #ffe6e6; padding: 10px; margin: 10px 0; border-radius: 3px;">
              <strong>Original:</strong>
              <pre style="margin: 5px 0;"><code>${this.escapeHtml(change.originalCode)}</code></pre>
            </div>
            ` : ''}
            <div style="background: #e6ffe6; padding: 10px; margin: 10px 0; border-radius: 3px;">
              <strong>New Code:</strong>
              <pre style="margin: 5px 0;"><code>${this.escapeHtml(change.newCode)}</code></pre>
            </div>
          </div>
        </div>
      `
      )
      .join('');

    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h1>🔧 Bug Fix Proposal</h1>
        
        <div style="background: #f0f8ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2>${proposal.title}</h2>
          <p><strong>Repository:</strong> ${repositoryUrl}</p>
          <p><strong>Issue:</strong> #${proposal.issueNumber}</p>
          <p><strong>Confidence:</strong> ${proposal.confidence}%</p>
        </div>

        <h3>📝 Description</h3>
        <p>${proposal.description}</p>

        <h3>💻 Proposed Changes</h3>
        ${changesHtml}

        <div style="margin: 30px 0; padding: 20px; background: #fff3cd; border-radius: 5px; text-align: center;">
          <h3>⚠️ Action Required</h3>
          <p>Please review the proposed fix and choose an action:</p>
          
          <div style="margin: 20px 0;">
            <a href="${approveUrl}" 
               style="background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 0 10px; display: inline-block;">
              ✅ Approve & Create PR
            </a>
            
            <a href="${rejectUrl}" 
               style="background: #dc3545; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 0 10px; display: inline-block;">
              ❌ Reject
            </a>
          </div>
          
          <p style="font-size: 12px; color: #666;">
            Or use curl:<br>
            <code>curl -X POST ${approveUrl}</code><br>
            <code>curl -X POST ${rejectUrl}</code>
          </p>
        </div>

        <hr style="margin: 30px 0;">
        <p style="font-size: 12px; color: #666;">
          Proposal ID: ${proposal.id}<br>
          Generated: ${proposal.createdAt.toISOString()}
        </p>
      </div>
    `;
  }

  private generateEmailText(proposal: FixProposal, approveUrl: string, rejectUrl: string): string {
    const changesText = proposal.codeChanges
      .map(
        (change) => `
File: ${change.filePath}
Explanation: ${change.explanation}
${change.originalCode ? `Original:\n${change.originalCode}\n` : ''}
New Code:\n${change.newCode}
---
`
      )
      .join('\n');

    return `
Bug Fix Proposal
================

Title: ${proposal.title}
Issue: #${proposal.issueNumber}
Confidence: ${proposal.confidence}%

Description:
${proposal.description}

Proposed Changes:
${changesText}

Actions:
- Approve: ${approveUrl}
- Reject: ${rejectUrl}

Proposal ID: ${proposal.id}
`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export function createEmailService(): EmailService {
  return new EmailService();
}