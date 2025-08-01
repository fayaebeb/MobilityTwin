import { pgTable, text, varchar, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const simulationMarkers = pgTable("simulation_markers", {
  id: varchar("id").primaryKey(),
  type: text("type").notNull(), // 'construction' or 'facility'
  coordinates: json("coordinates").notNull(), // { lng: number, lat: number }
  createdAt: timestamp("created_at").defaultNow(),
});

export const simulationResults = pgTable("simulation_results", {
  id: varchar("id").primaryKey(),
  markersData: json("markers_data").notNull(),
  drivingDistance: text("driving_distance").notNull(),
  congestionLength: text("congestion_length").notNull(),
  co2Emissions: text("co2_emissions").notNull(),
  aiSummary: text("ai_summary").notNull(),
  riskAssessment: json("risk_assessment").notNull(),
  recommendations: json("recommendations").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMarkerSchema = createInsertSchema(simulationMarkers).pick({
  type: true,
  coordinates: true,
});

export const insertSimulationResultSchema = createInsertSchema(simulationResults).pick({
  markersData: true,
  drivingDistance: true,
  congestionLength: true,
  co2Emissions: true,
  aiSummary: true,
  riskAssessment: true,
  recommendations: true,
});

export type InsertMarker = z.infer<typeof insertMarkerSchema>;
export type Marker = typeof simulationMarkers.$inferSelect;
export type SimulationResult = typeof simulationResults.$inferSelect;
export type InsertSimulationResult = z.infer<typeof insertSimulationResultSchema>;

// Types for API responses
export type SimulationMetrics = {
  driving_distance: string;
  congestion_length: string;
  co2_emissions: string;

  // Extra debug metrics
  roads_count?: number;
  nodes_count?: number;
  incidents_count?: number;
  affected_edges?: number;
  vehicle_sample?: Array<{
    id: string;
    speed: number;
    routeLength: number;
  }>;
  construction_impacts?: Array<{
    edgeId: string;
    originalSpeed: number;
    reducedSpeed: number;
  }>;
  vehicle_count?: number;
  population_summary?: {
    total: number;
    density: number;
  };
};


export type RiskItem = {
  level: 'high' | 'medium' | 'low';
  description: string;
};

export type Recommendation = {
  title: string;
  description: string;
  icon: string;
};

export type SimulationResponse = {
  metrics: SimulationMetrics;
  ai_summary: string;
  risk_assessment: RiskItem[];
  recommendations: Recommendation[];
};

// Live simulation data types
export type VehiclePosition = {
  id: string;
  coordinates: [number, number];
  speed: number;
  heading: number;
  routeProgress: number;
  route: [number, number][];
};

export type LiveSimulationData = {
  timestamp: number;
  vehicles: VehiclePosition[];
  congestionSegments: Array<{
    coordinates: [number, number][];
    level: 'high' | 'medium' | 'low';
  }>;
  totalVehicles: number;
  averageSpeed: number;
};
