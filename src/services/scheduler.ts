import cron, { ScheduledTask } from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { runScrapingJob } from './scrapingService';

const prisma = new PrismaClient();
let currentTask: ScheduledTask | null = null;

export const initScheduler = async () => {
  console.log('Initializing Scraping Scheduler...');
  await rescheduleJob();
};

export const rescheduleJob = async () => {
  try {
    // 1. Stop existing task if running
    if (currentTask) {
      currentTask.stop();
      currentTask = null;
      console.log('Stopped previous scraping schedule.');
    }

    // 2. Fetch active configuration
    const config = await prisma.scrapingConfig.findFirst({
      where: { isActive: true }
    });

    if (!config) {
      console.log('No active scraping configuration. Scheduler is idle.');
      return;
    }

    // 3. Schedule new task
    const cronExpression = config.scheduleCron || '0 0 * * *';
    
    // Validate cron expression basic check
    if (!cron.validate(cronExpression)) {
        console.error(`Invalid cron expression in DB: ${cronExpression}`);
        return;
    }

    currentTask = cron.schedule(cronExpression, async () => {
      console.log(`Cron triggered: Running scraping job based on ${config.provider}`);
      await runScrapingJob();
    });

    console.log(`Scraping scheduled successfully with cron: "${cronExpression}"`);
  } catch (error) {
    console.error('Failed to reschedule scraping job:', error);
  }
};
