import { type Marker, type InsertMarker, type SimulationResult, type InsertSimulationResult } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  createMarker(marker: InsertMarker): Promise<Marker>;
  getMarkers(): Promise<Marker[]>;
  clearMarkers(): Promise<void>;
  saveSimulationResult(result: InsertSimulationResult): Promise<SimulationResult>;
  getLatestSimulationResult(): Promise<SimulationResult | undefined>;
}

export class MemStorage implements IStorage {
  private markers: Map<string, Marker>;
  private simulationResults: Map<string, SimulationResult>;

  constructor() {
    this.markers = new Map();
    this.simulationResults = new Map();
  }

  async createMarker(insertMarker: InsertMarker): Promise<Marker> {
    const id = randomUUID();
    const marker: Marker = { 
      ...insertMarker, 
      id, 
      createdAt: new Date() 
    };
    this.markers.set(id, marker);
    return marker;
  }

  async getMarkers(): Promise<Marker[]> {
    return Array.from(this.markers.values());
  }

  async clearMarkers(): Promise<void> {
    this.markers.clear();
  }

  async saveSimulationResult(insertResult: InsertSimulationResult): Promise<SimulationResult> {
    const id = randomUUID();
    const result: SimulationResult = {
      ...insertResult,
      id,
      createdAt: new Date()
    };
    this.simulationResults.set(id, result);
    return result;
  }

  async getLatestSimulationResult(): Promise<SimulationResult | undefined> {
    const results = Array.from(this.simulationResults.values());
    return results.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))[0];
  }
}

export const storage = new MemStorage();
