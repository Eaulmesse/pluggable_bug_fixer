# Pluggable Bug Fixer

AI-powered GitHub bug fixer agent with manual validation. This agent monitors GitHub issues, analyzes them using LLM (DeepSeek), proposes code fixes, and creates Pull Requests only after manual email validation.

## Features

- **Automated Issue Monitoring**: Scans GitHub issues labeled with `bug` or `help wanted`
- **AI-Powered Analysis**: Uses DeepSeek to analyze issues and propose fixes
- **Manual Validation**: Sends email notifications with approve/reject links for every proposed fix
- **Automated Testing**: Runs tests before creating PRs
- **Safe Execution**: Local execution with full control

## Architecture

```
src/
├── config/         # Environment and configuration
├── services/       # Core services
│   ├── github.ts   # GitHub API wrapper
│   ├── llm.ts      # DeepSeek LLM client
│   ├── email.ts    # Email notification service
│   └── testRunner.ts # Test execution service
├── agents/         # AI agents
│   └── bugFixer.ts # Main bug fixing orchestration
├── routes/         # Express API routes
│   └── api.ts      # Validation endpoints
├── types/          # TypeScript types
└── utils/          # Utility functions
```

## Workflow

1. **Scan**: Fetch open issues with `bug` or `help wanted` labels
2. **Analyze**: Send issue + repository context to DeepSeek LLM
3. **Generate**: DeepSeek proposes fix with explanation
4. **Validate**: Email notification with approve/reject links
5. **Execute**: On approval → create branch, apply fix, run tests, create PR
6. **Feedback**: Email confirmation

## Prerequisites

- Node.js >= 18.0.0
- GitHub Personal Access Token
- DeepSeek API Key (https://platform.deepseek.com)
- SMTP email credentials

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/pluggable_bug_fixer.git
cd pluggable_bug_fixer

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
```

## Configuration

Create a `.env` file with the following variables:

```env
# GitHub
GITHUB_TOKEN=ghp_your_github_token

# LLM (DeepSeek)
LLM_API_KEY=your_deepseek_api_key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-coder

# Email (SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=your-email@gmail.com
EMAIL_TO=validation@example.com

# App
PORT=3000
SCAN_INTERVAL=0 */6 * * *
VALIDATION_URL=http://localhost:3000
```

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### API Endpoints

- `POST /api/validate/:proposalId/approve` - Approve a fix proposal
- `POST /api/validate/:proposalId/reject` - Reject a fix proposal
- `GET /api/proposals` - List all pending proposals
- `POST /api/scan` - Trigger manual issue scan

## GitHub Token Permissions

Your GitHub token needs the following permissions:

- `repo` - Full control of private repositories
- `workflow` - Update GitHub Action workflows
- `read:org` - Read org and team membership

## Email Setup

### Gmail

1. Enable 2-Factor Authentication
2. Generate an App Password
3. Use the app password in `EMAIL_PASS`

### Other Providers

Configure according to your provider's SMTP settings.

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type checking
npm run typecheck

# Linting
npm run lint
```

## License

MIT