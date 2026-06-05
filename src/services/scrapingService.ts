import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const runScrapingJob = async () => {
  try {
    console.log('Running scraping job...');
    
    // 1. Fetch active configuration
    const config = await prisma.scrapingConfig.findFirst({
      where: { isActive: true }
    });

    if (!config) {
      console.log('No active scraping config found. Exiting.');
      return;
    }

    if (config.provider === 'APIFY') {
      await runApifyScraping(config);
    } else if (config.provider === 'GOOGLE_MAPS') {
      await runGoogleMapsScraping(config);
    }

    console.log('Scraping job completed successfully.');
  } catch (error) {
    console.error('Error in scraping job:', error);
  }
};

const runApifyScraping = async (config: any) => {
  if (!config.apifyToken) {
    throw new Error('Apify token is missing in config.');
  }

  console.log('Triggering Apify Google Maps Scraper Actor...');
  
  // Here we would use axios to call the Apify API
  // Example for calling the "compass/google-maps-scraper" actor:
  // const response = await axios.post(`https://api.apify.com/v2/acts/compass~google-maps-scraper/runs?token=${config.apifyToken}`, {
  //   searchStringsArray: [config.searchQuery || 'restaurants'],
  //   maxCrawledPlacesPerSearch: 10,
  //   language: 'en',
  // });
  
  // // For demo purposes, we log the intended action
  console.log(`Called Apify with search query: ${config.searchQuery}`);
  
  // Note: Since Apify runs asynchronously, we would typically wait for the run to finish
  // or set up a webhook in a real production environment.
};

const runGoogleMapsScraping = async (config: any) => {
  if (!config.googleMapsApiKey) {
    throw new Error('Google Maps API Key is missing in config.');
  }

  console.log('Fetching data directly from Google Maps Places API...');
  
  const query = config.searchQuery || 'spas';
  
  // Example call to Google Maps Text Search API
  // const response = await axios.get(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${config.googleMapsApiKey}`);
  
  console.log(`Called Google Maps API with search query: ${query}`);
  
  // const places = response.data.results;
  // // Then loop through places and save them using prisma.visitBusiness.create({...})
};
