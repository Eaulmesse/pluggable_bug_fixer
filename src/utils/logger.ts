/**
 * Logger utility with colorful terminal output
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// Level styling
const levelStyles: Record<LogLevel, { color: string; emoji: string; label: string }> = {
  [LogLevel.DEBUG]: { color: colors.gray, emoji: '🔍', label: 'DEBUG' },
  [LogLevel.INFO]: { color: colors.cyan, emoji: 'ℹ️ ', label: 'INFO' },
  [LogLevel.WARN]: { color: colors.yellow, emoji: '⚠️ ', label: 'WARN' },
  [LogLevel.ERROR]: { color: colors.red, emoji: '❌', label: 'ERROR' },
};

class Logger {
  private isProduction = process.env.NODE_ENV === 'production';

  private formatTime(): string {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    return `${colors.dim}${hours}:${minutes}:${seconds}${colors.reset}`;
  }

  private formatMeta(meta?: any): string {
    if (!meta) return '';
    
    // Format meta object nicely
    const entries = Object.entries(meta);
    if (entries.length === 0) return '';

    const formatted = entries
      .map(([key, value]) => {
        let displayValue = value;
        if (typeof value === 'object' && value !== null) {
          displayValue = JSON.stringify(value).substring(0, 100);
          if (JSON.stringify(value).length > 100) displayValue += '...';
        }
        return `${colors.gray}${key}${colors.reset}=${colors.cyan}${displayValue}${colors.reset}`;
      })
      .join(' ');

    return ' ' + formatted;
  }

  private log(level: LogLevel, message: string, meta?: any): void {
    if (level === LogLevel.DEBUG && this.isProduction) return;

    const style = levelStyles[level];
    const time = this.formatTime();
    const metaStr = this.formatMeta(meta);

    const output = `${time} ${style.color}${style.emoji}${colors.reset} ${message}${metaStr}`;

    switch (level) {
      case LogLevel.ERROR:
        console.error(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  debug(message: string, meta?: any): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: any): void {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: any): void {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, meta?: any): void {
    this.log(LogLevel.ERROR, message, meta);
  }

  // Special formatting for scan operations
  scan(message: string, meta?: any): void {
    const time = this.formatTime();
    const metaStr = this.formatMeta(meta);
    console.log(`${time} ${colors.magenta}🔍${colors.reset} ${colors.bright}${message}${colors.reset}${metaStr}`);
  }

  // Special formatting for success
  success(message: string, meta?: any): void {
    const time = this.formatTime();
    const metaStr = this.formatMeta(meta);
    console.log(`${time} ${colors.green}✅${colors.reset} ${message}${metaStr}`);
  }

  // Special formatting for GitHub operations
  github(message: string, meta?: any): void {
    const time = this.formatTime();
    const metaStr = this.formatMeta(meta);
    console.log(`${time} ${colors.blue}🐙${colors.reset} ${message}${metaStr}`);
  }

  // Special formatting for LLM operations
  llm(message: string, meta?: any): void {
    const time = this.formatTime();
    const metaStr = this.formatMeta(meta);
    console.log(`${time} ${colors.yellow}🤖${colors.reset} ${message}${metaStr}`);
  }

  // Special formatting for email operations
  email(message: string, meta?: any): void {
    const time = this.formatTime();
    const metaStr = this.formatMeta(meta);
    console.log(`${time} ${colors.cyan}📧${colors.reset} ${message}${metaStr}`);
  }
}

export const logger = new Logger();

// Banner function for startup
export function printBanner(): void {
  console.log('');
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}  ${colors.bright}🔧 Pluggable Bug Fixer${colors.reset}                              ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}  ${colors.gray}AI-powered GitHub bug fixer with manual validation${colors.reset}  ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');
}