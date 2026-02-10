import { exec } from 'child_process';
import { promisify } from 'util';
import { TestResult } from '../types';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export class TestRunnerService {
  private workingDir: string;

  constructor(workingDir: string = process.cwd()) {
    this.workingDir = workingDir;
  }

  async runTests(): Promise<TestResult> {
    const startTime = Date.now();

    try {
      logger.info('Running tests...', { workingDir: this.workingDir });

      // Detect test framework
      const testCommand = await this.detectTestCommand();

      if (!testCommand) {
        logger.warn('No test command detected, skipping tests');
        return {
          passed: true,
          output: 'No tests configured',
          duration: Date.now() - startTime,
        };
      }

      const { stdout, stderr } = await execAsync(testCommand, {
        cwd: this.workingDir,
        timeout: 300000, // 5 minutes timeout
      });

      const output = stdout + stderr;
      const passed = !this.hasTestFailures(output);

      logger.info('Tests completed', { passed, duration: Date.now() - startTime });

      return {
        passed,
        output,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.error('Tests failed', { error });

      const output = error.stdout + error.stderr || error.message;

      return {
        passed: false,
        output,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async runBuild(): Promise<TestResult> {
    const startTime = Date.now();

    try {
      logger.info('Running build...', { workingDir: this.workingDir });

      const buildCommand = await this.detectBuildCommand();

      if (!buildCommand) {
        logger.warn('No build command detected, skipping build');
        return {
          passed: true,
          output: 'No build configured',
          duration: Date.now() - startTime,
        };
      }

      const { stdout, stderr } = await execAsync(buildCommand, {
        cwd: this.workingDir,
        timeout: 300000,
      });

      return {
        passed: true,
        output: stdout + stderr,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.error('Build failed', { error });

      return {
        passed: false,
        output: error.stdout + error.stderr || error.message,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async runLint(): Promise<TestResult> {
    const startTime = Date.now();

    try {
      logger.info('Running lint...');

      const lintCommand = await this.detectLintCommand();

      if (!lintCommand) {
        return {
          passed: true,
          output: 'No lint configured',
          duration: Date.now() - startTime,
        };
      }

      const { stdout, stderr } = await execAsync(lintCommand, {
        cwd: this.workingDir,
        timeout: 120000,
      });

      return {
        passed: true,
        output: stdout + stderr,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        passed: false,
        output: error.stdout + error.stderr || error.message,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private async detectTestCommand(): Promise<string | null> {
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      const packageJsonPath = path.join(this.workingDir, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      if (packageJson.scripts?.test) {
        return 'npm test';
      }
    } catch {
      // No package.json
    }

    // Check for common test files
    const testFiles = [
      'jest.config.js',
      'jest.config.ts',
      'vitest.config.js',
      'vitest.config.ts',
      'playwright.config.js',
      'cypress.json',
    ];

    for (const file of testFiles) {
      try {
        await fs.access(path.join(this.workingDir, file));
        if (file.includes('jest')) return 'npx jest';
        if (file.includes('vitest')) return 'npx vitest run';
        if (file.includes('playwright')) return 'npx playwright test';
        if (file.includes('cypress')) return 'npx cypress run';
      } catch {
        // File doesn't exist
      }
    }

    return null;
  }

  private async detectBuildCommand(): Promise<string | null> {
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      const packageJsonPath = path.join(this.workingDir, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      if (packageJson.scripts?.build) {
        return 'npm run build';
      }
    } catch {
      // No package.json
    }

    return null;
  }

  private async detectLintCommand(): Promise<string | null> {
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      const packageJsonPath = path.join(this.workingDir, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      if (packageJson.scripts?.lint) {
        return 'npm run lint';
      }
    } catch {
      // No package.json
    }

    return null;
  }

  private hasTestFailures(output: string): boolean {
    const failurePatterns = [
      /FAIL\s+/,
      /failed|failure/i,
      /error|errors/i,
      /✕|✖/,
      /failing/,
      /exit.*1/,
    ];

    return failurePatterns.some((pattern) => pattern.test(output));
  }
}

export function createTestRunnerService(workingDir?: string): TestRunnerService {
  return new TestRunnerService(workingDir);
}