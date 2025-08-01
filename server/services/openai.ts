import OpenAI from "openai";
import type { SimulationMetrics, RiskItem, Recommendation } from "@shared/schema";
import dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateTrafficAnalysis(
  markers: Array<{ type: string; coordinates: { lng: number; lat: number } }>,
  metrics: SimulationMetrics
): Promise<{
  ai_summary: string;
  risk_assessment: RiskItem[];
  recommendations: Recommendation[];
}> {
  try {
    const hasConstruction = markers.some(m => m.type === 'construction');
    const hasFacility = markers.some(m => m.type === 'facility');
    
    const prompt = `You are a traffic impact analysis expert. Analyze the following traffic simulation data and provide a comprehensive assessment in japanese.

Markers placed:
${markers.map(m => `- ${m.type} at coordinates (${m.coordinates.lng.toFixed(4)}, ${m.coordinates.lat.toFixed(4)})`).join('\n')}

Simulation Results:
- Total Driving Distance: ${metrics.driving_distance}
- Congestion Length: ${metrics.congestion_length}
- CO₂ Emissions: ${metrics.co2_emissions}

Please provide a JSON response with the following structure:
{
  "ai_summary": "A detailed paragraph summarizing the traffic impact, including specific effects on travel time, emissions, and affected areas",
  "risk_assessment": [
    {
      "level": "high|medium|low",
      "description": "Description of specific risk"
    }
  ],
  "recommendations": [
    {
      "title": "Short recommendation title",
      "description": "Detailed actionable recommendation",
      "icon": "fas fa-icon-name (Font Awesome icon class)"
    }
  ]
}

Focus on realistic traffic engineering solutions and consider the urban planning implications of the placed markers.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a traffic engineering and urban planning expert. Provide realistic, actionable analysis and recommendations based on traffic simulation data."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1500
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    return {
      ai_summary: result.ai_summary || "Analysis could not be generated.",
      risk_assessment: result.risk_assessment || [],
      recommendations: result.recommendations || []
    };
  } catch (error) {
    console.error("OpenAI analysis failed:", error);
    
    // Fallback analysis based on marker types
    const hasConstruction = markers.some(m => m.type === 'construction');
    const hasFacility = markers.some(m => m.type === 'facility');
    
    let fallbackSummary = "";
    const fallbackRisks: RiskItem[] = [];
    const fallbackRecommendations: Recommendation[] = [];
    
    if (hasConstruction) {
      fallbackSummary = `Construction zones create significant traffic disruption, with congestion length of ${metrics.congestion_length} and increased CO₂ emissions to ${metrics.co2_emissions}. Alternative routing strategies should be implemented.`;
      fallbackRisks.push({
        level: "high",
        description: "Construction-related congestion during peak hours"
      });
      fallbackRecommendations.push({
        title: "Alternative Routing",
        description: "Implement temporary traffic signals on parallel routes",
        icon: "fas fa-route"
      });
    }
    
    if (hasFacility) {
      fallbackSummary += ` New facility placement increases local traffic demand, contributing to the total driving distance of ${metrics.driving_distance}.`;
      fallbackRisks.push({
        level: "medium",
        description: "Increased local traffic demand from new facility"
      });
      fallbackRecommendations.push({
        title: "Capacity Planning",
        description: "Consider additional parking and improved public transit access",
        icon: "fas fa-building"
      });
    }
    
    return {
      ai_summary: fallbackSummary || "Traffic analysis indicates normal flow patterns with minimal disruption.",
      risk_assessment: fallbackRisks,
      recommendations: fallbackRecommendations
    };
  }
}
