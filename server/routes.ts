import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertMarkerSchema,
  type SimulationResponse,
} from "@shared/schema";
import { runTrafficSimulation } from "./services/simulation";
import { generateTrafficAnalysis } from "./services/openai";

export async function registerRoutes(app: Express): Promise<Server> {
  // ─────────────────────────────
  // MARKER ROUTES
  // ─────────────────────────────

  app.get("/api/markers", async (req, res) => {
    try {
      const markers = await storage.getMarkers();
      res.json(markers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch markers" });
    }
  });

  app.post("/api/markers", async (req, res) => {
    try {
      const validatedData = insertMarkerSchema.parse(req.body);
      const marker = await storage.createMarker(validatedData);
      res.json(marker);
    } catch (error) {
      res.status(400).json({ message: "Invalid marker data" });
    }
  });

  app.delete("/api/markers", async (req, res) => {
    try {
      await storage.clearMarkers();
      res.json({ message: "All markers cleared" });
    } catch (error) {
      res.status(500).json({ message: "Failed to clear markers" });
    }
  });

  // ─────────────────────────────
  // SYNCHRONOUS SIMULATION
  // ─────────────────────────────

  app.post("/api/simulate", async (req, res) => {
    try {
      const markers = await storage.getMarkers();
      if (markers.length === 0) {
        return res.status(400).json({ message: "No markers placed for simulation" });
      }

      const { duration = 60, radius = 3 } = req.body;

      const simulationMarkers = markers.map((m) => ({
        type: m.type,
        coordinates: m.coordinates as { lng: number; lat: number },
      }));

      const metrics = await runTrafficSimulation(simulationMarkers, duration, radius);

      const analysis = await generateTrafficAnalysis(simulationMarkers, metrics);

      await storage.saveSimulationResult({
        markersData: simulationMarkers,
        drivingDistance: metrics.driving_distance,
        congestionLength: metrics.congestion_length,
        co2Emissions: metrics.co2_emissions,
        aiSummary: analysis.ai_summary,
        riskAssessment: analysis.risk_assessment,
        recommendations: analysis.recommendations,
      });

      const response: SimulationResponse = {
        metrics,
        ai_summary: analysis.ai_summary,
        risk_assessment: analysis.risk_assessment,
        recommendations: analysis.recommendations,
      };

      res.json(response);
    } catch (error) {
      console.error("Simulation error:", error);
      res.status(500).json({ message: "Simulation failed. Please try again." });
    }
  });

  // ─────────────────────────────
  // STREAMING SIMULATION (SSE)
  // ─────────────────────────────

  app.get("/api/simulate/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (message: string | object) => {
      const payload = typeof message === "string" ? { message } : message;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const markers = await storage.getMarkers();

      if (!markers || markers.length === 0) {
        send("❗ No markers placed for simulation.");
        res.end();
        return;
      }

      const simulationMarkers = markers.map((m) => ({
        type: m.type,
        coordinates: m.coordinates as { lng: number; lat: number },
      }));

      const duration = Number(req.query.duration) || 60;
      const radius = Number(req.query.radius) || 3;

      send("🔄 Starting real simulation...");

      const metrics = await runTrafficSimulation(
        simulationMarkers,
        duration,
        radius,
        (step) => send(step)
      );

      send("🧠 Generating AI analysis...");

      const analysis = await generateTrafficAnalysis(simulationMarkers, metrics);

      await storage.saveSimulationResult({
        markersData: simulationMarkers,
        drivingDistance: metrics.driving_distance,
        congestionLength: metrics.congestion_length,
        co2Emissions: metrics.co2_emissions,
        aiSummary: analysis.ai_summary,
        riskAssessment: analysis.risk_assessment,
        recommendations: analysis.recommendations,
      });

      const response: SimulationResponse = {
        metrics,
        ai_summary: analysis.ai_summary,
        risk_assessment: analysis.risk_assessment,
        recommendations: analysis.recommendations,
      };

      send({ done: true, response });
    } catch (error: any) {
      console.error("❌ Stream simulation error:", error);
      send("❌ Simulation failed. See server logs for details.");
    } finally {
      res.end();
    }
  });

  // ─────────────────────────────
  // LIVE SIMULATION WITH VEHICLES (SSE)
  // ─────────────────────────────

  app.get("/api/simulate/live", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (message: string | object) => {
      const payload = typeof message === "string" ? { message } : message;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const markers = await storage.getMarkers();

      if (!markers || markers.length === 0) {
        send({ type: "error", message: "❗ No markers placed for simulation." });
        res.end();
        return;
      }

      const simulationMarkers = markers.map((m) => ({
        type: m.type,
        coordinates: m.coordinates as { lng: number; lat: number },
      }));

      const duration = Number(req.query.duration) || 60;
      const radius = Number(req.query.radius) || 3;

      send({ type: "status", message: "🔄 Initializing live simulation..." });

      // Import simulation services
      const { RealTrafficSimulation } = await import('./services/sumo-simulation');
      const { extractRoadNetwork } = await import('./services/osm-network');
      const { getTrafficData } = await import('./services/tomtom-traffic');
      const { getPopulationData } = await import('./services/population-data');

      // Calculate center point from markers
      const centerLat = simulationMarkers.reduce((sum, m) => sum + m.coordinates.lat, 0) / simulationMarkers.length;
      const centerLng = simulationMarkers.reduce((sum, m) => sum + m.coordinates.lng, 0) / simulationMarkers.length;

      // Calculate bounding box for data fetching
      const latDelta = radius / 111;
      const lngDelta = radius / (111 * Math.cos(centerLat * Math.PI / 180));
      const bbox = {
        minLat: centerLat - latDelta,
        maxLat: centerLat + latDelta,
        minLng: centerLng - lngDelta,
        maxLng: centerLng + lngDelta
      };

      const networkData = await extractRoadNetwork(centerLat, centerLng, radius);
      const trafficData = await getTrafficData(bbox);
      const populationData = await getPopulationData(bbox);

      const simulation = new RealTrafficSimulation(networkData, trafficData, populationData);

      // Set up live data callback
      simulation.setLiveDataCallback((liveData) => {
        // Debug log to check if callback is being called
        if (liveData.timestamp % 60 === 0) {
          console.log(`[SSE] Sending live data: t=${liveData.timestamp}s, vehicles=${liveData.vehicles.length}`);
        }
        
        send({ 
          type: "live_data", 
          data: liveData,
          message: `Time: ${Math.round(liveData.timestamp/60)}m ${Math.round(liveData.timestamp%60)}s | Vehicles: ${liveData.totalVehicles} | Avg Speed: ${liveData.averageSpeed} km/h`
        });
      });

      send({ type: "status", message: "🚗 Starting vehicle simulation..." });

      // Run the simulation with live updates
      const metrics = await simulation.simulate(simulationMarkers, duration);

      send({ type: "status", message: "🧠 Generating AI analysis..." });

      const analysis = await generateTrafficAnalysis(simulationMarkers, metrics);

      const response: SimulationResponse = {
        metrics,
        ai_summary: analysis.ai_summary,
        risk_assessment: analysis.risk_assessment,
        recommendations: analysis.recommendations,
      };

      send({ type: "complete", data: response });

    } catch (error: any) {
      console.error("❌ Live simulation error:", error);
      send({ type: "error", message: "❌ Live simulation failed. Please try again." });
      res.end(); // ✅ Only close if there's an error
    }

  });

  // Start HTTP server
  const httpServer = createServer(app);
  return httpServer;
}
