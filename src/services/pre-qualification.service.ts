import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface PreQualificationResult {
  score: number;
  tier: string;
  rltStatus: string;
  aiJustification: string;
}

export class PreQualificationService {
  /**
   * Use OpenAI to score and pre-qualify a business based on its raw scraped data.
   */
  static async evaluateBusiness(name: string, category: string, address: string): Promise<PreQualificationResult> {
    if (!process.env.OPENAI_API_KEY) {
      console.warn("OPENAI_API_KEY is not set. Defaulting to Tier 3.");
      return {
        score: 50,
        tier: "Tier 3",
        rltStatus: "Unknown",
        aiJustification: "OpenAI API Key missing. Defaulted to Tier 3.",
      };
    }

    try {
      const prompt = `
You are an expert B2B sales analyst for a Red Light Therapy (RLT) equipment manufacturer.
Your job is to evaluate clinics based on their Name, Category, and Address to determine if they are a good lead for selling RLT beds/panels.

**Primary Qualification Targets:**
- Recovery Clinics (Sports recovery, physiotherapy, rehab)
- Wellness Facilities (Wellness centers, biohacking, cryotherapy, IV therapy, holistic)
- Longevity Facilities (Anti-aging, functional medicine)

**Disqualification Targets (-100 points):**
- Dental clinics, Dentists
- General pharmacies
- General practitioners / standard hospitals
- Cosmetic salons with ONLY beauty services
- Dermatology clinics (unless highly wellness focused)
- Any clinic clearly not related to wellness/recovery

**RLT Qualification Status Guess:**
- "Already Has RLT" (If name implies light therapy)
- "Likely No RLT"
- "Unknown"

**Priority Scoring (0-100):**
- Tier 1 (Score 80-100): Perfect fit (Recovery/Wellness/Biohacking) AND likely doesn't have RLT yet.
- Tier 2 (Score 60-79): Great fit, but already has RLT (upgrade opportunity), or is a slight stretch but still very relevant.
- Tier 3 (Score 40-59): Unknown fit. Category is vague. Needs verification.
- Disqualified (Score 0-39): Do not visit (Dentist, Pharmacy, etc).

Evaluate this business:
Name: "${name}"
Category: "${category}"
Address: "${address}"

Respond ONLY in valid JSON with exactly these keys:
{
  "score": number, // 0 to 100
  "tier": string, // "Tier 1", "Tier 2", "Tier 3", or "Disqualified"
  "rltStatus": string, // "Already Has RLT", "Likely No RLT", or "Unknown"
  "reason": string // 1 short sentence explaining why
}
`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Very fast and cheap for this task
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("No content from OpenAI");

      const result = JSON.parse(content);

      return {
        score: result.score || 50,
        tier: result.tier || "Tier 3",
        rltStatus: result.rltStatus || "Unknown",
        aiJustification: result.reason || "Evaluated by AI",
      };
    } catch (error) {
      console.error("OpenAI Pre-Qualification Error for business:", name, error);
      return {
        score: 50,
        tier: "Tier 3",
        rltStatus: "Unknown",
        aiJustification: "OpenAI evaluation failed. Defaulted to Tier 3.",
      };
    }
  }
}
