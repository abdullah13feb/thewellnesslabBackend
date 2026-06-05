import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { sendWhatsappMessage } from '../lib/whatsappGateway.js';

const prisma = new PrismaClient();
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export class VisitSchedulerService {
  /**
   * Discover businesses using Dynamic Config (Google Places API or Apify)
   */
  static async discoverBusinesses(location: string, categories: string[], maxVisits: number = 10) {
    // Fetch dynamic configuration from DB
    const config = await prisma.scrapingConfig.findFirst({
      where: { isActive: true }
    });

    const provider = config?.provider || 'GOOGLE_MAPS';
    const apiKey = config?.googleMapsApiKey || process.env.GOOGLE_MAPS_API_KEY;
    const apifyKey = config?.apifyToken;
    const query = `${categories.join(' OR ')} in ${location}`;
    const businesses = [];

    if (provider === 'GOOGLE_MAPS') {
      if (!apiKey) {
        throw new Error('Google Maps API Key is not configured in DB or .env.');
      }

      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;

      try {
        const response = await axios.get(url);
        const places = response.data.results || [];

        for (const place of places.slice(0, maxVisits * 2)) {
          let business = await prisma.visitBusiness.findUnique({
            where: { placeId: place.place_id },
          });

          if (!business) {
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,geometry,formatted_phone_number,website,rating,user_ratings_total,opening_hours&key=${apiKey}`;
            const detailsResponse = await axios.get(detailsUrl);
            const details = detailsResponse.data.result || place;

            business = await prisma.visitBusiness.create({
              data: {
                placeId: place.place_id,
                name: details.name || place.name,
                address: details.formatted_address || place.formatted_address,
                latitude: details.geometry?.location?.lat,
                longitude: details.geometry?.location?.lng,
                phone: details.formatted_phone_number,
                website: details.website,
                rating: details.rating || place.rating,
                reviewCount: details.user_ratings_total || place.user_ratings_total,
                openingHours: details.opening_hours || null,
                category: categories[0],
              },
            });
          }
          businesses.push(business);
        }
      } catch (error) {
        console.error('Error discovering businesses with Google Maps:', error);
        throw error;
      }
    } else if (provider === 'APIFY') {
      if (!apifyKey) {
        throw new Error('Apify Token is not configured in DB.');
      }

      console.log('Triggering Apify Google Maps Scraper Actor synchronously for a test...');
      
      try {
         // Use run-sync-get-dataset-items to force the backend to wait for the results
         const response = await axios.post(`https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items?token=${apifyKey}`, {
           searchStringsArray: [query],
           maxCrawledPlacesPerSearch: maxVisits * 2,
           language: 'en',
         });
         
         console.log(`Apify completed. Fetched items count: ${response.data.length}`);
         const places = response.data || [];

         for (const place of places) {
           if (!place.placeId) continue;
           
           let business = await prisma.visitBusiness.findUnique({
             where: { placeId: place.placeId },
           });

           if (!business) {
             business = await prisma.visitBusiness.create({
               data: {
                 placeId: place.placeId,
                 name: place.title || place.name || "Unknown",
                 address: place.address || null,
                 latitude: place.location?.lat || null,
                 longitude: place.location?.lng || null,
                 phone: place.phoneUnformatted || place.phone || null,
                 website: place.website || null,
                 rating: place.totalScore || null,
                 reviewCount: place.reviewsCount || 0,
                 openingHours: place.openingHours || null,
                 category: place.categoryName || categories[0],
               },
             });
           }
           businesses.push(business);
         }
      } catch (error) {
        console.error('Error discovering businesses with Apify:', error);
        throw error;
      }
    }

    return businesses.slice(0, maxVisits);
  }

  /**
   * Optimize the route and create a schedule
   */
  static async generateSchedule(data: {
    date: Date;
    salespersonId: string;
    startLocation: string;
    endLocation: string;
    businesses: any[]; // Array of VisitBusiness
  }) {
    // 1. Create the Schedule
    const schedule = await prisma.visitSchedule.create({
      data: {
        date: new Date(data.date),
        salespersonId: data.salespersonId,
        startLocation: data.startLocation,
        endLocation: data.endLocation,
      },
    });

    // 2. Simple routing heuristic (In reality, use Google Directions API to optimize waypoints)
    // For now, we just order them sequentially
    const visits = [];
    let currentTime = new Date(data.date);
    currentTime.setHours(9, 0, 0, 0); // Start at 9:00 AM

    for (let i = 0; i < data.businesses.length; i++) {
      const business = data.businesses[i];

      const plannedTimeStr = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;

      const visit = await prisma.visit.create({
        data: {
          scheduleId: schedule.id,
          businessId: business.id,
          orderIndex: i + 1,
          plannedTime: plannedTimeStr,
          status: 'PLANNED',
          checklistBefore: {
            checkWebsite: false,
            checkReviews: false,
            preparePitch: false,
            confirmHours: false
          },
          checklistDuring: {
            meetDecisionMaker: false,
            explainServices: false,
            collectDetails: false
          },
          checklistAfter: {
            addNotes: false,
            markInterest: false,
            scheduleFollowUp: false
          }
        },
      });

      visits.push({ ...visit, business });

      // Add 45 mins per visit
      currentTime.setMinutes(currentTime.getMinutes() + 45);
    }

    // 3. Dispatch WhatsApp Notification
    try {
      const salesperson = await prisma.salesperson.findUnique({
        where: { id: data.salespersonId }
      });

      if (salesperson && salesperson.whatsappNumber) {
        const waypoints = visits.map((v: any) => encodeURIComponent(v.business.address || `${v.business.latitude},${v.business.longitude}` || v.business.name)).join('|');
        const startLoc = encodeURIComponent(data.startLocation || 'Dubai');
        const endLoc = encodeURIComponent(data.endLocation || data.startLocation || 'Dubai');
        
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${startLoc}&destination=${endLoc}&waypoints=${waypoints}`;
        
        const message = `Hello ${salesperson.name}!\n\nYour field visit route for today is ready. You have ${visits.length} visits starting at 09:00 AM.\n\nClick the link below to open your route in Google Maps:\n\n${mapsUrl}`;

        // Use the default session to send the message
        await sendWhatsappMessage("default", salesperson.whatsappNumber, message);
        console.log(`WhatsApp itinerary sent to ${salesperson.name}`);
      }
    } catch (err) {
      console.error("Failed to send WhatsApp itinerary:", err);
    }

    return { schedule, visits };
  }
}
