import { createEmailService } from '../services/email';
import { logger } from '../utils/logger';

async function testEmailService() {
  console.log('📧 Testing Email Service...\n');

  try {
    const emailService = createEmailService();

    // Test 1: Verify connection
    console.log('1️⃣ Testing connection...');
    const connected = await emailService.verifyConnection();

    if (!connected) {
      console.error('❌ Email connection failed');
      process.exit(1);
    }
    console.log('✅ Connection verified\n');

    // Test 2: Send test email
    console.log('2️⃣ Sending test email...');
    
    // Create a mock proposal for testing
    const testProposal = {
      id: 'test_' + Date.now(),
      issueNumber: 1,
      title: 'Test Fix for Email Verification',
      description: 'This is a test email to verify the email configuration is working correctly.',
      codeChanges: [
        {
          filePath: 'src/test.ts',
          originalCode: 'console.log("old code");',
          newCode: 'console.log("new code");',
          explanation: 'Updated log message for testing',
        },
      ],
      explanation: 'Test fix for email verification',
      confidence: 95,
      createdAt: new Date(),
      status: 'pending' as const,
    };

    await emailService.sendValidationEmail(testProposal, 'test/repo');
    console.log('✅ Test email sent successfully');
    console.log('\n📨 Check your inbox at:', process.env.EMAIL_TO);

  } catch (error: any) {
    console.error('❌ Email test failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

testEmailService();