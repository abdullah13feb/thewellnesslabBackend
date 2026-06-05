import cron, { ScheduledTask } from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { VisitSchedulerService } from './visit-scheduler.service.js';

const prisma = new PrismaClient();
let currentTask: ScheduledTask | null = null;

export const initWeeklyScheduler = async () => {
  console.log('Initializing Weekly Automation Scheduler...');
  await rescheduleWeeklyJob();
};

export const rescheduleWeeklyJob = async () => {
  try {
    if (currentTask) {
      currentTask.stop();
      currentTask = null;
    }

    // Run every minute (* * * * *) to check for matching times
    const cronExpression = '* * * * *';
    
    currentTask = cron.schedule(cronExpression, async () => {
      await runWeeklyAutomationJob();
    });

    console.log(`Weekly Automation scheduled successfully with cron: "${cronExpression}"`);
  } catch (error) {
    console.error('Failed to reschedule weekly automation job:', error);
  }
};

export const runWeeklyAutomationJob = async () => {
  console.log('Starting Weekly Automation generation for today...');
  
  try {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Format current time as HH:mm to match runTime
    const hours = today.getHours().toString().padStart(2, '0');
    const minutes = today.getMinutes().toString().padStart(2, '0');
    const currentTimeString = `${hours}:${minutes}`;

    // Fetch active configurations for today that match the exact current minute
    const configs = await prisma.weeklyVisitConfig.findMany({
      where: { 
        dayOfWeek,
        runTime: currentTimeString,
        isActive: true 
      }
    });

    if (configs.length === 0) {
      return; // No config matches this exact minute, fail silently
    }

    for (const config of configs) {
      if (!config.salespersonIds || config.salespersonIds.length === 0) continue;

      console.log(`Processing config for ${config.targetLocation} with ${config.salespersonIds.length} salespersons.`);

      // To prevent all salespeople from getting the exact same places, 
      // we can discover enough businesses for everyone.
      const totalVisitsNeeded = config.maxVisits * config.salespersonIds.length;
      
      const categoriesList = config.categories.split(',').map(c => c.trim());
      
      const businesses = await VisitSchedulerService.discoverBusinesses(
        config.targetLocation, 
        categoriesList, 
        Math.min(totalVisitsNeeded + 10, 50) // fetch a bit extra, cap at 50 to avoid huge delays
      );

      if (!businesses || businesses.length === 0) {
        console.warn(`No businesses found for ${config.targetLocation}. Skipping.`);
        continue;
      }

      // We assign slices of the discovered businesses to each salesperson
      let businessIndex = 0;

      for (const salespersonId of config.salespersonIds) {
        const salespersonVisits = businesses.slice(businessIndex, businessIndex + config.maxVisits);
        
        if (salespersonVisits.length === 0) {
          console.warn(`Ran out of unique businesses to assign to salesperson ${salespersonId}`);
          break;
        }
        
        businessIndex += config.maxVisits;

        try {
          await VisitSchedulerService.generateSchedule({
            date: today,
            salespersonId,
            startLocation: config.startLocation || config.targetLocation,
            endLocation: config.endLocation || config.targetLocation,
            businesses: salespersonVisits
          });
          
          console.log(`Generated schedule for salesperson ${salespersonId}`);
        } catch (scheduleErr) {
          console.error(`Failed to generate schedule for salesperson ${salespersonId}:`, scheduleErr);
        }
      }
    }
    
    console.log('Weekly Automation generation completed.');
  } catch (error) {
    console.error('Error during runWeeklyAutomationJob:', error);
  }
};
