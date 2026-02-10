import { createGitHubService } from '../services/github';
import { config } from '../config';

async function testGitHubService() {
  console.log('🧪 Testing GitHub Service...\n');

  try {
    // Test avec ce repo (pluggable_bug_fixer)
    const service = createGitHubService('Eaulmesse/pluggable_bug_fixer');

    // Test 1: Get default branch
    console.log('1️⃣ Testing getDefaultBranch()...');
    const defaultBranch = await service.getDefaultBranch();
    console.log(`✅ Default branch: ${defaultBranch}\n`);

    // Test 2: Get issues (même si vide)
    console.log('2️⃣ Testing getIssues()...');
    const issues = await service.getIssues(['bug', 'help wanted']);
    console.log(`✅ Found ${issues.length} issues\n`);

    if (issues.length > 0) {
      console.log('📋 First issue:', {
        number: issues[0].number,
        title: issues[0].title,
        labels: issues[0].labels,
      });
    }

    // Test 3: Get file content
    console.log('3️⃣ Testing getFileContent()...');
    const packageJson = await service.getFileContent('package.json', defaultBranch);
    if (packageJson) {
      const pkg = JSON.parse(packageJson);
      console.log(`✅ Found package.json: ${pkg.name} v${pkg.version}\n`);
    }

    // Test 4: Get repository content
    console.log('4️⃣ Testing getRepositoryContent()...');
    const srcContent = await service.getRepositoryContent('src', defaultBranch);
    console.log(`✅ Src directory content:\n${srcContent}\n`);

    console.log('🎉 All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testGitHubService();