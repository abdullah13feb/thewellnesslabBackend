import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { sendWhatsappMessage } from '../lib/whatsappGateway.js';

const prisma = new PrismaClient();
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export class VisitSchedulerService {
  /**
   * Discover businesses using Google Places API
   */
  static async discoverBusinesses(location: string, categories: string[], maxVisits: number = 10) {
    if (!GOOGLE_API_KEY) {
      throw new Error('Google Maps API Key is not configured.');
    }

    // This is a simplified example using Text Search. In a real scenario, you'd use Nearby Search with lat/lng.
    const query = `${categories.join(' OR ')} in ${location}`;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}`;

    try {
      const response = await axios.get(url);
      const places = response.data.results || [];

      const businesses = [];
      for (const place of places.slice(0, maxVisits * 2)) { // Fetch more to allow filtering
        // Check if business already exists
        let business = await prisma.visitBusiness.findUnique({
          where: { placeId: place.place_id },
        });

        if (!business) {
          // If not, fetch details (like phone, website, hours)
          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,geometry,formatted_phone_number,website,rating,user_ratings_total,opening_hours&key=${GOOGLE_API_KEY}`;
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
              category: categories[0], // simplified
            },
          });
        }
        businesses.push(business);
      }

      // Filter recently visited logic can be added here
      return businesses.slice(0, maxVisits);
    } catch (error) {
      console.error('Error discovering businesses:', error);
      throw error;
    }
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
        const portalUrl = process.env.FRONTEND_URL || "https://admin.thewellnesslab.ae";
        const message = `Hello ${salesperson.name}!\n\nYour field visit route for today is ready. You have ${visits.length} visits starting at 09:00 AM.\n\nClick here to view your schedule and start your visits: ${portalUrl}/admin/visits`;

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
