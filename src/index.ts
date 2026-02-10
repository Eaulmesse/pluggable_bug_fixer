import express from 'express';
import { config } from './config';
import apiRoutes from './routes/api';
import { printBanner } from './utils/logger';

const app = express();

app.use(express.json());

// Routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = config.app.port;

printBanner();

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Validation URL: ${config.app.validationUrl}`);
  console.log(`🔍 Scan interval: ${config.app.scanInterval}`);
  console.log('');
});