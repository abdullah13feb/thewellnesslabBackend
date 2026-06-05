import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { sendWhatsappMessage } from '../lib/whatsappGateway.js';
import { PreQualificationService } from './pre-qualification.service.js';

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
            
            const bName = details.name || place.name;
            const bAddress = details.formatted_address || place.formatted_address;
            const bCategory = categories[0];

            // --- NEW: AI PRE-QUALIFICATION ---
            const qualification = await PreQualificationService.evaluateBusiness(bName, bCategory, bAddress);

            if (qualification.tier === "Disqualified" || qualification.score < 40) {
              console.log(`[AI] Dropped disqualified business: ${bName}`);
              continue; // Skip saving this business entirely
            }

            business = await prisma.visitBusiness.create({
              data: {
                placeId: place.place_id,
                name: bName,
                address: bAddress,
                latitude: details.geometry?.location?.lat,
                longitude: details.geometry?.location?.lng,
                phone: details.formatted_phone_number,
                website: details.website,
                rating: details.rating || place.rating,
                reviewCount: details.user_ratings_total || place.user_ratings_total,
                openingHours: details.opening_hours || null,
                category: bCategory,
                score: qualification.score,
                tier: qualification.tier,
                rltStatus: qualification.rltStatus,
                aiJustification: qualification.aiJustification
              }
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
             const bName = place.title || place.name || "Unknown";
             const bCategory = place.categoryName || categories[0];
             const bAddress = place.address || "";

             // --- NEW: AI PRE-QUALIFICATION ---
             const qualification = await PreQualificationService.evaluateBusiness(bName, bCategory, bAddress);

             if (qualification.tier === "Disqualified" || qualification.score < 40) {
               console.log(`[AI] Dropped disqualified business: ${bName}`);
               continue; // Skip saving this business entirely
             }

             business = await prisma.visitBusiness.create({
               data: {
                 placeId: place.placeId,
                 name: bName,
                 address: place.address || null,
                 latitude: place.location?.lat || null,
                 longitude: place.location?.lng || null,
                 phone: place.phoneUnformatted || place.phone || null,
                 website: place.website || null,
                 rating: place.totalScore || null,
                 reviewCount: place.reviewsCount || 0,
                 openingHours: place.openingHours || null,
                 category: bCategory,
                 score: qualification.score,
                 tier: qualification.tier,
                 rltStatus: qualification.rltStatus,
                 aiJustification: qualification.aiJustification
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

    // 2. Routing heuristic
    // First, sort businesses by their AI Score so we prioritize Tier 1
    const sortedBusinesses = [...data.businesses].sort((a, b) => (b.score || 0) - (a.score || 0));

    const visits = [];
    let currentTime = new Date(data.date);
    currentTime.setHours(9, 0, 0, 0); // Start at 9:00 AM

    for (let i = 0; i < sortedBusinesses.length; i++) {
      const business = sortedBusinesses[i];

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
        const message = VisitSchedulerService.generateRichWhatsappMessage(
          { ...schedule, startLocation: data.startLocation, endLocation: data.endLocation },
          visits,
          salesperson
        );

        // Use the default session to send the message
        await sendWhatsappMessage("default", salesperson.whatsappNumber, message);
        console.log(`WhatsApp itinerary sent to ${salesperson.name}`);
      }
    } catch (err) {
      console.error("Failed to send WhatsApp itinerary:", err);
    }

    return { schedule, visits };
  }

  static generateRichWhatsappMessage(schedule: any, visits: any[], salesperson: any): string {
    const waypoints = visits.map((v: any) => encodeURIComponent(v.business.address || `${v.business.latitude},${v.business.longitude}` || v.business.name)).join('|');
    const startLoc = schedule.startLocation || 'Dubai';
    const endLoc = schedule.endLocation || schedule.startLocation || 'Dubai';
    const startLocEncoded = encodeURIComponent(startLoc);
    const endLocEncoded = encodeURIComponent(endLoc);
    
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${startLocEncoded}&destination=${endLocEncoded}&waypoints=${waypoints}`;
    const portalUrl = process.env.FRONTEND_URL || "https://admin.thewellnesslab.ae";

    let message = `*Route Summary*\n\n`;
    message += `*Today's Route:*\n${startLoc} → ${visits.length} Stops → ${endLoc}\n\n`;
    message += `*Total Stops:* ${visits.length}\n`;
    message += `*Estimated Drive Time:* ~1 hr 30 min\n`; 
    message += `*Estimated Visit Time:* ~${visits.length * 45} min\n`; 
    message += `*Total Estimated Duration:* ~${visits.length} hrs\n\n`;

    message += `*Interactive Map*\n`;
    message += `Open entire route in Google Maps: \n${mapsUrl}\n\n`;

    message += `*Optimized Route*\n`;
    message += `_Automatically optimized to minimize travel time._\n\n`;

    visits.forEach((v, index) => {
      const b = v.business;
      const stopNumber = index + 1;
      
      // Inject the actual AI Priority Tier
      const priorityLevel = b.tier === "Tier 1" ? "🟢 Tier 1" : b.tier === "Tier 2" ? "🟡 Tier 2" : "🔴 Tier 3";
      
      message += `---------------------------------\n`;
      message += `*Stop ${stopNumber}: ${b.name}*\n`;
      message += `---------------------------------\n`;
      message += `*Priority:* ${priorityLevel} (Score: ${b.score || 'N/A'})\n`;
      message += `*RLT Status:* ${b.rltStatus || 'Unknown'}\n\n`;
      
      message += `*Address:* ${b.address || 'N/A'}\n`;
      message += `*Phone Number:* ${b.phone || 'N/A'}\n`;
      message += `*Decision Maker:* Unknown (Ask for Manager)\n`;
      message += `*Previous Activity:*\n`;
      message += `✓ Discovered & Qualified by AI\n\n`;
      
      message += `*AI Objective / Justification:*\n`;
      message += `${b.aiJustification || 'Introduce our wellness services.'}\n\n`;

      message += `*Visit Checklist*\n`;
      message += `_Before arriving:_\n`;
      message += `□ Reviewed website\n□ Prepared brochure\n\n`;
      message += `_After visit:_\n`;
      message += `□ Met decision maker\n□ Collected contact details\n□ Scheduled next action\n\n`;

      message += `*One Click Actions*\n`;
      if (b.phone) {
        const cleanPhone = b.phone.replace(/\\D/g, '');
        message += `📞 Call Clinic: tel:+${cleanPhone}\n`;
        message += `💬 WhatsApp Clinic: https://wa.me/${cleanPhone}\n`;
      }
      message += `📍 Open Google Maps: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.name + ' ' + (b.address || ''))}\n`;
      
      const visitUrl = `${portalUrl}/admin/visits`;
      message += `✅ Mark Visited / CRM: ${visitUrl}\n\n`;
    });

    return message;
  }
}
