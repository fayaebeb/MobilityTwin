import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, Play, Car, Square, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { SimulationResponse, LiveSimulationData } from '@shared/schema';
import SimulationResults from '@/components/SimulationResults';
import { useLiveSimulation } from '@/hooks/use-live-simulation';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

interface ControlPanelProps {
  markerCount: number;
  onLiveDataUpdate?: (data: LiveSimulationData | null) => void;
  onVehicleVisibilityChange?: (visible: boolean) => void;
}

export default function ControlPanel({ 
  markerCount, 
  onLiveDataUpdate, 
  onVehicleVisibilityChange 
}: ControlPanelProps) {
  const { toast } = useToast();
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [radiusKm, setRadiusKm] = useState(3);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [showVehicles, setShowVehicles] = useState(false);
  const [useLiveMode, setUseLiveMode] = useState(false);
  const [logVisible, setLogVisible] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const liveSimulation = useLiveSimulation();

  const [simulationResults, setSimulationResults] = useState<SimulationResponse | null>(() => {
    const saved = localStorage.getItem('simulationResults');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (simulationResults) {
      localStorage.setItem('simulationResults', JSON.stringify(simulationResults));
    }
  }, [simulationResults]);

  useEffect(() => {
    onLiveDataUpdate?.(liveSimulation.liveData);
  }, [liveSimulation.liveData, onLiveDataUpdate]);

  useEffect(() => {
    onVehicleVisibilityChange?.(showVehicles && (liveSimulation.isRunning || !!liveSimulation.liveData));
  }, [showVehicles, liveSimulation.isRunning, liveSimulation.liveData, onVehicleVisibilityChange]);

  const simulationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/simulate', {
        body: JSON.stringify({ duration: durationMinutes, radius: radiusKm }),
      });
      return response.json() as Promise<SimulationResponse>;
    },
    onSuccess: (data) => {
      setSimulationResults(data);
      setLogVisible(false); // Hide log after completion
      toast({
        title: 'Simulation Complete',
        description: 'Traffic impact analysis has been generated.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Simulation Failed',
        description: error.message || 'Unable to run simulation. Please try again.',
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [progressLog]);

  useEffect(() => {
    if (!simulationMutation.isPending) return;

    const eventSource = new EventSource('/api/simulate/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.message) {
          setProgressLog((prev) => [...prev, data.message]);
        } else if (data.done && data.response) {
          setSimulationResults(data.response);
          setLogVisible(false); // Hide log when SSE simulation ends
        }
      } catch (err) {
        console.error('Malformed SSE data:', event.data);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, [simulationMutation.isPending]);

  const handleSimulate = () => {
    if (markerCount === 0) {
      toast({
        title: 'No Markers',
        description: 'Please place markers on the map before running simulation.',
        variant: 'destructive',
      });
      return;
    }

    setLogVisible(true); // Show log at start of simulation
    setProgressLog([]);

    if (useLiveMode) {
      liveSimulation.startLiveSimulation(durationMinutes, radiusKm);
    } else {
      simulationMutation.mutate();
    }
  };

  const handleStopSimulation = () => {
    liveSimulation.stopLiveSimulation();
  };

  const clearResults = () => {
    localStorage.removeItem('simulationResults');
    setSimulationResults(null);
    liveSimulation.clearResults();
  };

  return (
    <div className="w-96 bg-white border-l border-gray-200 flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b p-4">
        <h2 className="text-lg font-semibold text-gray-900">Simulation Control</h2>
        <p className="text-sm text-gray-500">Configure and run traffic impact analysis</p>
      </div>

      {/* Simulation Mode Toggle */}
      <div className="space-y-3 px-4 pt-2">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Simulation Mode
          </label>
          <div className="flex items-center space-x-3">
            <Switch
              checked={useLiveMode}
              onCheckedChange={setUseLiveMode}
              id="live-mode"
            />
            <label htmlFor="live-mode" className="text-sm text-gray-600 cursor-pointer">
              {useLiveMode ? (
                <span className="flex items-center gap-2">
                  <Car className="h-4 w-4" />
                  Live Vehicle Simulation
                </span>
              ) : (
                'Standard Analysis'
              )}
            </label>
          </div>
        </div>

        {useLiveMode && (
          <div className="space-y-2">
            <div className="flex items-center space-x-3">
              <Switch
                checked={showVehicles}
                onCheckedChange={setShowVehicles}
                id="show-vehicles"
              />
              <label htmlFor="show-vehicles" className="text-sm text-gray-600 cursor-pointer">
                {showVehicles ? (
                  <span className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Show Vehicles
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <EyeOff className="h-4 w-4" />
                    Hide Vehicles
                  </span>
                )}
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Duration Selector */}
      <div className="space-y-1 px-4 pt-2">
        <label htmlFor="duration" className="block text-sm font-medium text-gray-700">
          Simulation Duration
        </label>
        <Select
          value={durationMinutes.toString()}
          onValueChange={(value) => setDurationMinutes(Number(value))}
        >
          <SelectTrigger id="duration" className="w-full">
            <SelectValue placeholder="Select duration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="15">15 minutes</SelectItem>
            <SelectItem value="30">30 minutes</SelectItem>
            <SelectItem value="60">60 minutes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Radius Selector */}
      <div className="space-y-1 px-4 pt-2">
        <label htmlFor="radius" className="block text-sm font-medium text-gray-700">
          Simulation Radius (km)
        </label>
        <Select
          value={radiusKm.toString()}
          onValueChange={(value) => setRadiusKm(Number(value))}
        >
          <SelectTrigger id="radius" className="w-full">
            <SelectValue placeholder="Select radius" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1 km</SelectItem>
            <SelectItem value="2">2 km</SelectItem>
            <SelectItem value="3">3 km</SelectItem>
            <SelectItem value="4">4 km</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Simulation Button */}
      <div className="space-y-4 px-4 pt-4">
        {useLiveMode && liveSimulation.isRunning ? (
          <Button
            onClick={handleStopSimulation}
            className="w-full bg-red-600 hover:bg-red-700 text-white"
            size="lg"
          >
            <Square className="mr-2 h-4 w-4" />
            Stop Live Simulation
          </Button>
        ) : (
          <Button
            onClick={handleSimulate}
            disabled={markerCount === 0 || simulationMutation.isPending || liveSimulation.isRunning}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            size="lg"
          >
            {(simulationMutation.isPending || liveSimulation.isRunning) ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {useLiveMode ? 'Live Simulating...' : 'Simulating...'}
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                {useLiveMode ? 'Start Live Simulation' : 'Run Simulation'}
              </>
            )}
          </Button>
        )}

        <div className="text-xs text-muted-foreground text-center pb-2">
          {markerCount === 0
            ? 'Add markers to the map to enable simulation'
            : `${markerCount} marker${markerCount !== 1 ? 's' : ''} placed`}
        </div>
      </div>

      {/* Live Progress Log */}
      {/* Live Progress Log with toggle */}
      {(progressLog.length > 0 || liveSimulation.logs.length > 0 || simulationMutation.isPending || liveSimulation.isRunning) && (
        <div className="px-4 space-y-1">
          <div className="flex justify-between items-center">
            <p className="text-sm font-medium text-gray-700">Live Progress Log</p>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs px-2 py-0 h-6"
              onClick={() => setLogVisible(!logVisible)}
            >
              {logVisible ? 'Minimize' : 'Expand'}
            </Button>
          </div>

          {logVisible && (
            <div
              ref={logContainerRef}
              className="bg-gray-50 border border-gray-200 rounded p-2 max-h-48 overflow-y-auto text-xs font-mono"
            >
              {useLiveMode ? (
                liveSimulation.logs.length === 0 ? (
                  <div className="text-gray-500">Waiting for live updates...</div>
                ) : (
                  liveSimulation.logs.map((line, i) => <div key={i}>{line}</div>)
                )
              ) : (
                progressLog.length === 0 ? (
                  <div className="text-gray-500">Waiting for updates...</div>
                ) : (
                  progressLog.map((line, i) => <div key={i}>{line}</div>)
                )
              )}
            </div>
          )}
        </div>
      )}


      {/* Simulation Results */}
      <SimulationResults
        isLoading={simulationMutation.isPending || liveSimulation.isRunning}
        simulationResults={simulationResults || liveSimulation.finalResults}
        onClear={clearResults}
      />
    </div>
  );
}
